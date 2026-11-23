-- =====================================================================
-- Romualdo's Platform · 02 · Inventory
-- One item master for both workspaces; stock is held SEPARATELY per workspace.
-- Stock is never "edited": every change is a row in stock_moves (the ledger),
-- so every kilo can be traced to a receipt, an issue, waste, or a count.
-- =====================================================================

create table suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  kind       text not null default 'market stall' check (kind in ('market stall', 'supplier', 'grocery', 'online', 'other')),
  contact    text,
  phone      text,
  terms      text,                      -- e.g. 'cash', '15 days'
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table items (
  id               uuid primary key default gen_random_uuid(),
  name             text unique not null,
  category         text not null default 'Other',
  stock_unit       text not null default 'kg',      -- unit counted & used in recipes (kg, L, pc, pack, can, bundle)
  purchase_unit    text not null default 'kg',      -- unit usually bought in (sack, tray, case…)
  units_per_purchase numeric(12,3) not null default 1 check (units_per_purchase > 0),  -- e.g. Rice: 1 sack = 50 kg; Eggs: 1 tray = 30 pc
  last_cost        numeric(12,2) not null default 0, -- per STOCK unit, updated on every receipt
  waste_pct        numeric(5,2) not null default 0 check (waste_pct between 0 and 80), -- trimming/cleaning loss added when planning
  perishable       boolean not null default true,
  preferred_supplier uuid references suppliers(id),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
comment on column items.waste_pct is 'Planning buffer: needs are increased by this % (e.g. 10 for whole fish, 0 for canned goods).';

create table item_par (
  item_id   uuid references items(id) on delete cascade,
  ws        workspace,
  par_qty   numeric(12,3) not null default 0,   -- keep at least this much on hand
  order_up_to numeric(12,3),                    -- restock to this level (defaults to par)
  primary key (item_id, ws)
);

create type move_kind as enum ('opening', 'receipt', 'issue', 'return', 'waste', 'transfer_out', 'transfer_in', 'count_adjust');

create table stock_moves (
  id          bigint generated always as identity primary key,
  ws          workspace not null,
  item_id     uuid not null references items(id),
  kind        move_kind not null,
  qty         numeric(12,3) not null check (qty <> 0),      -- signed: + into the store, − out of it
  unit_cost   numeric(12,2) not null default 0,
  event_id    uuid,                                          -- catering event this stock was for (FK added later)
  ref_type    text,                                          -- 'receipt', 'issue_slip', 'count', 'transfer'…
  ref_id      text,
  reason      text,
  note        text,
  moved_at    timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  check ((kind in ('opening', 'receipt', 'return', 'transfer_in') and qty > 0) or (kind in ('issue', 'waste', 'transfer_out') and qty < 0) or kind = 'count_adjust')
);
create index on stock_moves (ws, item_id);
create index on stock_moves (event_id);

create view stock_on_hand with (security_invoker = true) as
select m.ws, m.item_id, i.name, i.category, i.stock_unit,
       round(sum(m.qty), 3)                         as on_hand,
       round(sum(m.qty) * max(i.last_cost), 2)      as value,
       max(m.moved_at) filter (where m.kind = 'count_adjust' or m.kind = 'opening') as last_counted
from stock_moves m join items i on i.id = m.item_id
group by m.ws, m.item_id, i.name, i.category, i.stock_unit;

create or replace function on_hand(w workspace, item uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0) from stock_moves where ws = w and item_id = item
$$;

-- ---------- physical counts ----------
create table stock_counts (
  id          uuid primary key default gen_random_uuid(),
  ws          workspace not null,
  counted_at  timestamptz not null default now(),
  counted_by  uuid default auth.uid() references profiles(id),
  witness     text,
  blind       boolean not null default true,
  status      text not null default 'open' check (status in ('open', 'posted', 'void')),
  posted_at   timestamptz,
  loss_value  numeric(12,2),
  gain_value  numeric(12,2),
  note        text
);
create table stock_count_lines (
  count_id  uuid references stock_counts(id) on delete cascade,
  item_id   uuid references items(id),
  counted   numeric(12,3) not null check (counted >= 0),
  expected  numeric(12,3),          -- filled when posted (hidden from counter during a blind count)
  primary key (count_id, item_id)
);

-- Post a count: the difference becomes a count_adjust move (the unexplained loss or gain)
create or replace function post_count(p_count uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c stock_counts; l record; exp numeric; loss numeric := 0; gain numeric := 0; d numeric; cost numeric;
begin
  select * into c from stock_counts where id = p_count for update;
  if c.id is null or c.status <> 'open' then raise exception 'Count not found or already posted'; end if;
  perform require_role(c.ws, array['storekeeper', 'manager', 'chef']::app_role[]);
  for l in select * from stock_count_lines where count_id = p_count loop
    exp := on_hand(c.ws, l.item_id);
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

-- Stock out of the store that isn't for a catering event: daily kitchen issue, waste, transfer between workspaces
create or replace function post_stock_out(p_ws workspace, p_kind move_kind, p_lines jsonb, p_reason text default null, p_note text default null, p_received_by text default null)
returns int language plpgsql security definer set search_path = public as $$
declare l jsonb; n int := 0; q numeric; it items; other workspace;
begin
  if p_kind not in ('issue', 'waste', 'transfer_out') then raise exception 'Use issue, waste or transfer_out'; end if;
  perform require_role(p_ws, case when p_kind = 'waste' then array['storekeeper', 'manager', 'chef', 'staff'] else array['storekeeper', 'manager', 'chef'] end::app_role[]);
  if p_kind = 'waste' and coalesce(p_reason, '') = '' then raise exception 'Waste needs a reason'; end if;
  other := case when p_ws = 'restaurant' then 'catering'::workspace else 'restaurant'::workspace end;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric;
    if q is null or q <= 0 then continue; end if;
    select * into it from items where id = (l->>'item_id')::uuid;
    insert into stock_moves(ws, item_id, kind, qty, unit_cost, ref_type, reason, note)
    values (p_ws, it.id, p_kind, -q, it.last_cost, 'stock_out', p_reason, concat_ws(' · ', p_note, 'received by ' || p_received_by));
    if p_kind = 'transfer_out' then
      insert into stock_moves(ws, item_id, kind, qty, unit_cost, ref_type, note)
      values (other, it.id, 'transfer_in', q, it.last_cost, 'transfer', 'from ' || p_ws);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
