-- Restaurant order-taking POS (tablet). It does NOT issue invoices: the BIR invoice still comes from the
-- registered POS. Prices, service charge and discounts are computed here on the server so the tablet can't change them.
-- Paying an order adds its dishes to the day's kitchen "Sold"; voiding a paid order takes them back off.

alter table restaurant_menu add column if not exists price numeric(10,2) check (price is null or price >= 0);
alter table restaurant_menu add column if not exists on_pos boolean not null default true;   -- shown on the POS
-- (restaurant_menu.active = counted in Kitchen stocks; drinks, rice and add-ons can be on_pos but not counted)

create table if not exists pos_settings (
  id           int primary key default 1 check (id = 1),
  sc_rate      numeric(5,2) not null default 10,     -- service charge %, dine-in only
  senior_pct   numeric(5,2) not null default 20,     -- Senior citizen / PWD discount % (non-VAT business)
  slip_footer  text not null default 'Order slip only — not an invoice. Please ask the cashier for your invoice.'
);
insert into pos_settings(id) values (1) on conflict do nothing;

create table if not exists pos_shifts (
  id            uuid primary key default gen_random_uuid(),
  opened_at     timestamptz not null default now(),
  opened_by     uuid references profiles(id) default auth.uid(),
  opening_cash  numeric(12,2) not null default 0 check (opening_cash >= 0),
  closed_at     timestamptz,
  closed_by     uuid references profiles(id),
  counted_cash  numeric(12,2),
  expected_cash numeric(12,2),
  over_short    numeric(12,2),
  note          text
);
create unique index if not exists one_open_shift on pos_shifts ((closed_at is null)) where closed_at is null;

create table if not exists pos_orders (
  id          uuid primary key default gen_random_uuid(),
  order_no    int not null,
  biz_date    date not null default (now() at time zone 'Asia/Manila')::date,
  kind        text not null default 'dine_in' check (kind in ('dine_in', 'take_out', 'delivery')),
  table_no    text,
  pax         int not null default 1 check (pax >= 1),
  seniors     int not null default 0 check (seniors >= 0),     -- Senior citizens + PWD in the group
  customer    text,
  note        text,
  status      text not null default 'open' check (status in ('open', 'paid', 'void')),
  subtotal    numeric(12,2) not null default 0,
  sc_amount   numeric(12,2) not null default 0,
  discount    numeric(12,2) not null default 0,
  total       numeric(12,2) not null default 0,
  paid_cash   numeric(12,2) not null default 0, paid_card numeric(12,2) not null default 0,
  paid_gcash  numeric(12,2) not null default 0, paid_charge numeric(12,2) not null default 0,
  pay_ref     text,                 -- card / GCash reference or who the charge is for
  change_due  numeric(12,2) not null default 0,
  invoice_no  text,                 -- the registered POS invoice number, if the cashier types it
  shift_id    uuid references pos_shifts(id),
  opened_by   uuid references profiles(id) default auth.uid(),
  opened_at   timestamptz not null default now(),
  paid_by     uuid references profiles(id), paid_at timestamptz,
  void_reason text, voided_by uuid references profiles(id), voided_at timestamptz,
  unique (biz_date, order_no)
);
create table if not exists pos_lines (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references pos_orders(id) on delete cascade,
  dish_id     uuid not null references dishes(id),
  name        text not null,
  qty         numeric(8,2) not null check (qty > 0),
  price       numeric(10,2) not null,
  note        text,
  sent_at     timestamptz,          -- sent to the kitchen
  created_at  timestamptz not null default now()
);
create index if not exists pos_lines_order on pos_lines(order_id);
create index if not exists pos_orders_day on pos_orders(biz_date, status);

-- totals from the lines, the settings and the head count
create or replace function pos_recalc(p_order uuid) returns pos_orders
language plpgsql security definer set search_path = public as $$
declare o pos_orders; s pos_settings; sub numeric; sc numeric; disc numeric;
begin
  select * into s from pos_settings where id = 1;
  select * into o from pos_orders where id = p_order for update;
  select coalesce(sum(qty * price), 0) into sub from pos_lines where order_id = p_order;
  sc := case when o.kind = 'dine_in' then round(sub * s.sc_rate / 100, 2) else 0 end;
  disc := case when o.seniors > 0 then round(sub * least(o.seniors, o.pax)::numeric / o.pax * s.senior_pct / 100, 2) else 0 end;
  update pos_orders set subtotal = sub, sc_amount = sc, discount = disc, total = sub + sc - disc where id = p_order returning * into o;
  return o;
end $$;

-- Create or update an open order. p: {id?, kind, table_no, pax, seniors, customer, note, lines:[{dish_id, qty, note}]}
-- Prices come from the menu, never from the tablet. Lines already sent to the kitchen can only be removed by a manager.
create or replace function pos_save(p jsonb) returns pos_orders
language plpgsql security definer set search_path = public as $$
declare o pos_orders; l jsonb; m record; d date := (now() at time zone 'Asia/Manila')::date; mgr boolean;
begin
  perform require_role('restaurant', array['cashier', 'manager', 'staff']::app_role[]);
  mgr := has_role('restaurant', array['manager']::app_role[]);
  if p ? 'id' and nullif(p ->> 'id', '') is not null then
    select * into o from pos_orders where id = (p ->> 'id')::uuid for update;
    if o.status <> 'open' then raise exception 'This order is already %', o.status; end if;
  else
    perform pg_advisory_xact_lock(hashtext('pos_no' || d));
    insert into pos_orders(order_no, biz_date, shift_id)
    values (coalesce((select max(order_no) from pos_orders where biz_date = d), 0) + 1, d, (select id from pos_shifts where closed_at is null limit 1))
    returning * into o;
  end if;
  update pos_orders set kind = coalesce(nullif(p ->> 'kind', ''), kind), table_no = nullif(p ->> 'table_no', ''),
         pax = greatest(coalesce(nullif(p ->> 'pax', '')::int, pax), 1), seniors = greatest(coalesce(nullif(p ->> 'seniors', '')::int, 0), 0),
         customer = nullif(p ->> 'customer', ''), note = nullif(p ->> 'note', '')
  where id = o.id;
  if not mgr and exists (select 1 from pos_lines x where x.order_id = o.id and x.sent_at is not null
                         and not exists (select 1 from jsonb_array_elements(coalesce(p -> 'lines', '[]')) j where (j ->> 'id') = x.id::text and (j ->> 'qty')::numeric >= x.qty)) then
    raise exception 'Dishes already sent to the kitchen can only be removed or reduced by a manager';
  end if;
  delete from pos_lines x where x.order_id = o.id and not exists (select 1 from jsonb_array_elements(coalesce(p -> 'lines', '[]')) j where (j ->> 'id') = x.id::text);
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    if (l ->> 'qty')::numeric <= 0 then continue; end if;
    if nullif(l ->> 'id', '') is not null and exists (select 1 from pos_lines where id = (l ->> 'id')::uuid and order_id = o.id) then
      update pos_lines set qty = (l ->> 'qty')::numeric, note = nullif(l ->> 'note', '') where id = (l ->> 'id')::uuid;
    else
      select d2.name, rm.price into m from restaurant_menu rm join dishes d2 on d2.id = rm.dish_id where rm.dish_id = (l ->> 'dish_id')::uuid and rm.on_pos;
      if m.price is null then raise exception 'No price set for this dish yet'; end if;
      insert into pos_lines(order_id, dish_id, name, qty, price, note) values (o.id, (l ->> 'dish_id')::uuid, m.name, (l ->> 'qty')::numeric, m.price, nullif(l ->> 'note', ''));
    end if;
  end loop;
  return pos_recalc(o.id);
end $$;

-- Mark everything not yet sent as sent; returns the lines to print on the kitchen ticket
create or replace function pos_send(p_order uuid) returns setof pos_lines
language plpgsql security definer set search_path = public as $$
begin
  perform require_role('restaurant', array['cashier', 'manager', 'staff']::app_role[]);
  return query update pos_lines set sent_at = now() where order_id = p_order and sent_at is null returning *;
end $$;

-- add or remove portions from the kitchen count of a day (beginning = the last saved ending when the row is new)
create or replace function pos_kitchen_sold(p_order uuid, p_sign int) returns void
language plpgsql security definer set search_path = public as $$
declare d date; r record;
begin
  select biz_date into d from pos_orders where id = p_order;
  for r in select l.dish_id, sum(l.qty) q from pos_lines l join restaurant_menu m on m.dish_id = l.dish_id and m.active where l.order_id = p_order group by l.dish_id loop
    insert into dish_day_counts(count_date, dish_id, beginning, sold, counted_by)
    values (d, r.dish_id, coalesce((select x.ending from dish_day_counts x where x.dish_id = r.dish_id and x.count_date < d order by x.count_date desc limit 1), 0), greatest(p_sign * r.q, 0), auth.uid())
    on conflict (count_date, dish_id) do update set sold = greatest(dish_day_counts.sold + p_sign * r.q, 0), updated_at = now();
  end loop;
  insert into kitchen_days(count_date, saved_by) values (d, auth.uid()) on conflict do nothing;
end $$;

create or replace function pos_pay(p_order uuid, p_cash numeric, p_card numeric, p_gcash numeric, p_charge numeric, p_ref text, p_invoice text)
returns pos_orders language plpgsql security definer set search_path = public as $$
declare o pos_orders; paid numeric;
begin
  perform require_role('restaurant', array['cashier', 'manager']::app_role[]);
  o := pos_recalc(p_order);
  if o.status <> 'open' then raise exception 'This order is already %', o.status; end if;
  if not exists (select 1 from pos_lines where order_id = p_order) then raise exception 'The order is empty'; end if;
  if least(coalesce(p_cash, 0), coalesce(p_card, 0), coalesce(p_gcash, 0), coalesce(p_charge, 0)) < 0 then raise exception 'Amounts cannot be negative'; end if;
  paid := coalesce(p_cash, 0) + coalesce(p_card, 0) + coalesce(p_gcash, 0) + coalesce(p_charge, 0);
  if paid < o.total then raise exception 'Payment is short by %', to_char(o.total - paid, 'FM999,999,990.00'); end if;
  if coalesce(p_card, 0) + coalesce(p_gcash, 0) + coalesce(p_charge, 0) > o.total then raise exception 'Only cash can be more than the bill'; end if;
  if coalesce(p_charge, 0) > 0 and coalesce(btrim(p_ref), '') = '' then raise exception 'Write who the charge is for'; end if;
  update pos_lines set sent_at = coalesce(sent_at, now()) where order_id = p_order;
  update pos_orders set status = 'paid', paid_cash = coalesce(p_cash, 0) - (paid - o.total), paid_card = coalesce(p_card, 0), paid_gcash = coalesce(p_gcash, 0),
         paid_charge = coalesce(p_charge, 0), change_due = paid - o.total, pay_ref = nullif(btrim(p_ref), ''), invoice_no = nullif(btrim(p_invoice), ''),
         paid_by = auth.uid(), paid_at = now(), shift_id = coalesce(shift_id, (select id from pos_shifts where closed_at is null limit 1))
  where id = p_order returning * into o;
  perform pos_kitchen_sold(p_order, 1);
  return o;
end $$;

create or replace function pos_void(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o pos_orders;
begin
  select * into o from pos_orders where id = p_order for update;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give the reason for voiding'; end if;
  if o.status = 'void' then return; end if;
  if o.status = 'paid' or exists (select 1 from pos_lines where order_id = p_order and sent_at is not null) then
    perform require_role('restaurant', array['manager']::app_role[]);      -- paid or already cooking: manager only
  else
    perform require_role('restaurant', array['cashier', 'manager', 'staff']::app_role[]);
  end if;
  if o.status = 'paid' then perform pos_kitchen_sold(p_order, -1); end if;
  update pos_orders set status = 'void', void_reason = p_reason, voided_by = auth.uid(), voided_at = now() where id = p_order;
end $$;

create or replace function pos_open_shift(p_cash numeric) returns pos_shifts
language plpgsql security definer set search_path = public as $$
declare s pos_shifts;
begin
  perform require_role('restaurant', array['cashier', 'manager']::app_role[]);
  if exists (select 1 from pos_shifts where closed_at is null) then raise exception 'A cash drawer is already open'; end if;
  insert into pos_shifts(opening_cash, opened_by) values (greatest(coalesce(p_cash, 0), 0), auth.uid()) returning * into s;
  return s;
end $$;

create or replace function pos_close_shift(p_counted numeric, p_note text) returns pos_shifts
language plpgsql security definer set search_path = public as $$
declare s pos_shifts; exp numeric;
begin
  perform require_role('restaurant', array['cashier', 'manager']::app_role[]);
  select * into s from pos_shifts where closed_at is null for update;
  if s.id is null then raise exception 'No cash drawer is open'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Count the cash in the drawer'; end if;
  if exists (select 1 from pos_orders where shift_id = s.id and status = 'open') then raise exception 'Some orders are still open — bill them out or void them first'; end if;
  exp := s.opening_cash + coalesce((select sum(paid_cash) from pos_orders where shift_id = s.id and status = 'paid'), 0);
  update pos_shifts set closed_at = now(), closed_by = auth.uid(), counted_cash = p_counted, expected_cash = exp, over_short = p_counted - exp, note = nullif(p_note, '')
  where id = s.id returning * into s;
  return s;
end $$;

-- Daily sales, built from paid orders (the "Z-reading" of this app)
create or replace view pos_daily with (security_invoker = true) as
select biz_date,
       count(*) filter (where status = 'paid') as orders,
       count(*) filter (where status = 'void') as voids,
       coalesce(sum(pax) filter (where status = 'paid'), 0) as guests,
       coalesce(sum(subtotal) filter (where status = 'paid'), 0) as gross,
       coalesce(sum(subtotal) filter (where status = 'paid' and kind <> 'dine_in'), 0) as gross_no_sc,
       coalesce(sum(sc_amount) filter (where status = 'paid'), 0) as service_charge,
       coalesce(sum(discount) filter (where status = 'paid'), 0) as discounts,
       coalesce(sum(total) filter (where status = 'paid'), 0) as net,
       coalesce(sum(paid_cash) filter (where status = 'paid'), 0) as cash,
       coalesce(sum(paid_card) filter (where status = 'paid'), 0) as card,
       coalesce(sum(paid_gcash) filter (where status = 'paid'), 0) as gcash,
       coalesce(sum(paid_charge) filter (where status = 'paid'), 0) as charge,
       coalesce(sum(total) filter (where status = 'void' and paid_at is not null), 0) as voided_paid
from pos_orders group by biz_date;

-- The registered POS's own Z-reading, typed or read from a photo at closing, to cross-check
alter table daily_sales add column if not exists source text not null default 'manual';
alter table daily_sales add column if not exists gcash numeric(12,2);
alter table daily_sales add column if not exists charge numeric(12,2);
alter table daily_sales add column if not exists guests int;
alter table daily_sales add column if not exists or_from text;
alter table daily_sales add column if not exists or_to text;
alter table daily_sales add column if not exists note text;

-- Security
alter table pos_settings enable row level security; alter table pos_shifts enable row level security;
alter table pos_orders enable row level security; alter table pos_lines enable row level security;
create policy "read" on pos_settings for select using (member_of('restaurant'));
create policy "edit" on pos_settings for update using (has_role('restaurant', array['manager']::app_role[]));
create policy "read" on pos_shifts for select using (member_of('restaurant'));
create policy "read" on pos_orders for select using (member_of('restaurant'));
create policy "invoice no" on pos_orders for update using (has_role('restaurant', array['cashier', 'manager']::app_role[]) and status = 'paid')
  with check (status = 'paid');
create policy "read" on pos_lines for select using (member_of('restaurant'));
grant select on pos_settings, pos_shifts, pos_orders, pos_lines, pos_daily to authenticated;
grant update (sc_rate, senior_pct, slip_footer) on pos_settings to authenticated;
grant update (invoice_no) on pos_orders to authenticated;
revoke execute on function pos_recalc(uuid), pos_kitchen_sold(uuid, int) from public, anon, authenticated;
revoke execute on function pos_save(jsonb), pos_send(uuid), pos_pay(uuid, numeric, numeric, numeric, numeric, text, text), pos_void(uuid, text), pos_open_shift(numeric), pos_close_shift(numeric, text) from public, anon;
grant execute on function pos_save(jsonb), pos_send(uuid), pos_pay(uuid, numeric, numeric, numeric, numeric, text, text), pos_void(uuid, text), pos_open_shift(numeric), pos_close_shift(numeric, text) to authenticated;
do $$ declare t text; begin
  foreach t in array array['pos_orders', 'pos_shifts', 'pos_settings'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = t::regclass) then
      execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_trigger()', t);
    end if;
  end loop;
end $$;
