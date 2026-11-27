-- Stock per kitchen + transfers between kitchens (catering).
-- Every stock move now says WHICH kitchen it happened in (stock_moves.loc = kitchen id from app_config 'kitchens').
-- Old moves have no kitchen: they count as the main kitchen (the first kitchen in the list).
-- The catering total does not change: a transfer is one move out of one kitchen and one move into the other.

alter table stock_moves  add column if not exists loc text;
alter table stock_counts add column if not exists loc text;
create index if not exists stock_moves_loc on stock_moves (ws, loc, item_id);

-- The main kitchen = first kitchen in the Delivery settings list
create or replace function main_kitchen() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select (value::jsonb)->0->>'id' from app_config where key = 'kitchens'), 'main')
$$;
grant execute on function main_kitchen() to authenticated;

-- Fill in the kitchen on every catering move:
--   1. what the caller asked for (rom.loc, set by the *_at functions below)
--   2. otherwise the event's kitchen, for anything bought for or issued to an event
--   3. otherwise the main kitchen
create or replace function stock_move_loc() returns trigger language plpgsql set search_path = public as $$
begin
  if new.ws = 'catering' and new.loc is null then
    new.loc := coalesce(nullif(current_setting('rom.loc', true), ''),
                        (select e.kitchen from events e where e.id = new.event_id),
                        main_kitchen());
  end if;
  return new;
end $$;
drop trigger if exists stock_move_loc on stock_moves;
create trigger stock_move_loc before insert on stock_moves for each row execute function stock_move_loc();

-- On hand per kitchen
create or replace view stock_by_kitchen with (security_invoker = true) as
select m.ws, coalesce(m.loc, main_kitchen()) as loc, m.item_id, i.name, i.category, i.stock_unit,
       round(sum(m.qty), 3) as on_hand, round(sum(m.qty) * max(i.last_cost), 2) as value
from stock_moves m join items i on i.id = m.item_id
where m.ws = 'catering'
group by m.ws, coalesce(m.loc, main_kitchen()), m.item_id, i.name, i.category, i.stock_unit;
grant select on stock_by_kitchen to authenticated;

create or replace function on_hand_at(item uuid, p_loc text) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0) from stock_moves where ws = 'catering' and item_id = item and coalesce(loc, main_kitchen()) = p_loc
$$;

-- Move stock from one kitchen to the other
create or replace function kitchen_transfer(p_from text, p_to text, p_lines jsonb, p_received_by text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l jsonb; q numeric; it items; n int := 0; ref uuid := gen_random_uuid(); kits jsonb; fname text; tname text; short text := '';
begin
  perform require_role('catering', array['storekeeper', 'manager', 'chef', 'head_chef', 'purchaser']::app_role[]);
  select value::jsonb into kits from app_config where key = 'kitchens';
  select k->>'name' into fname from jsonb_array_elements(coalesce(kits, '[]')) k where k->>'id' = p_from;
  select k->>'name' into tname from jsonb_array_elements(coalesce(kits, '[]')) k where k->>'id' = p_to;
  if fname is null or tname is null then raise exception 'Pick both kitchens'; end if;
  if p_from = p_to then raise exception 'Pick two different kitchens'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric; if q is null or q <= 0 then continue; end if;
    select * into it from items where id = (l->>'item_id')::uuid;
    if it.id is null then raise exception 'Unknown item'; end if;
    if on_hand_at(it.id, p_from) < q then short := short || case when short = '' then '' else ', ' end || it.name; end if;
    insert into stock_moves(ws, item_id, kind, qty, unit_cost, ref_type, ref_id, loc, note)
    values ('catering', it.id, 'transfer_out', -q, it.last_cost, 'kitchen_transfer', ref::text, p_from,
            concat_ws(' · ', 'to ' || tname, 'received by ' || nullif(p_received_by, ''), nullif(p_note, '')));
    insert into stock_moves(ws, item_id, kind, qty, unit_cost, ref_type, ref_id, loc, note)
    values ('catering', it.id, 'transfer_in', q, it.last_cost, 'kitchen_transfer', ref::text, p_to,
            concat_ws(' · ', 'from ' || fname, 'received by ' || nullif(p_received_by, ''), nullif(p_note, '')));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Enter a quantity for at least one item'; end if;
  return jsonb_build_object('items', n, 'ref', ref, 'short', nullif(short, ''));
end $$;

-- Recent transfers, one row per transfer
create or replace function kitchen_transfers(p_limit int default 20) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.at desc), '[]') from (
    select m.ref_id as ref, max(m.moved_at) as at, max(m.loc) filter (where m.kind = 'transfer_out') as from_loc,
           max(m.loc) filter (where m.kind = 'transfer_in') as to_loc, max(p.full_name) as who,
           max(m.note) filter (where m.kind = 'transfer_in') as note,
           count(*) filter (where m.kind = 'transfer_in') as items, round(sum(m.qty * m.unit_cost) filter (where m.kind = 'transfer_in'), 2) as value,
           jsonb_agg(jsonb_build_object('name', i.name, 'qty', m.qty, 'unit', i.stock_unit) order by i.name) filter (where m.kind = 'transfer_in') as lines
    from stock_moves m join items i on i.id = m.item_id left join profiles p on p.id = m.created_by
    where m.ws = 'catering' and m.ref_type = 'kitchen_transfer' and member_of('catering')
    group by m.ref_id order by max(m.moved_at) desc limit p_limit) t
$$;
grant execute on function kitchen_transfer(text, text, jsonb, text, text), kitchen_transfers(int), on_hand_at(uuid, text) to authenticated;

-- Receive an order into a chosen kitchen
create or replace function receive_po_at(p_loc text, p_po uuid, p_lines jsonb, p_or_no text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform set_config('rom.loc', coalesce(p_loc, ''), true);
  return receive_po(p_po, p_lines, p_or_no, p_note);
end $$;
grant execute on function receive_po_at(text, uuid, jsonb, text, text) to authenticated;

-- Issue / waste out of a chosen kitchen (catering)
create or replace function issue_to_event_at(p_loc text, p_event uuid, p_lines jsonb, p_received_by text, p_return boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
begin
  perform set_config('rom.loc', coalesce(p_loc, ''), true);
  return issue_to_event(p_event, p_lines, p_received_by, p_return);
end $$;
grant execute on function issue_to_event_at(text, uuid, jsonb, text, boolean) to authenticated;

-- A count of one kitchen compares against that kitchen's stock only
create or replace function post_count(p_count uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare c stock_counts; l record; exp numeric; loss numeric := 0; gain numeric := 0; d numeric; cost numeric;
begin
  select * into c from stock_counts where id = p_count for update;
  if c.id is null or c.status <> 'open' then raise exception 'Count not found or already posted'; end if;
  perform require_role(c.ws, array['storekeeper', 'manager', 'chef']::app_role[]);
  if c.ws = 'catering' then perform set_config('rom.loc', coalesce(c.loc, main_kitchen()), true); end if;
  for l in select * from stock_count_lines where count_id = p_count loop
    exp := case when c.ws = 'catering' then on_hand_at(l.item_id, coalesce(c.loc, main_kitchen())) else on_hand(c.ws, l.item_id) end;
    update stock_count_lines set expected = exp where count_id = p_count and item_id = l.item_id;
    d := l.counted - exp;
    if d <> 0 then
      select last_cost into cost from items where id = l.item_id;
      insert into stock_moves(ws, item_id, kind, qty, unit_cost, ref_type, ref_id, reason)
      values (c.ws, l.item_id, 'count_adjust', d, cost, 'count', p_count::text, case when d < 0 then 'missing at count' else 'excess at count' end);
      if d < 0 then loss := loss + d * cost; else gain := gain + d * cost; end if;
    end if;
  end loop;
  update stock_counts set status = 'posted', posted_at = now(), loss_value = round(loss, 2), gain_value = round(gain, 2) where id = p_count;
  return jsonb_build_object('loss_value', round(loss, 2), 'gain_value', round(gain, 2));
end $$;
