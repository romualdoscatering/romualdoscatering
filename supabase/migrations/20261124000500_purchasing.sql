-- =====================================================================
-- Romualdo's Platform · 05 · Purchasing & receiving
--   Request (PR)  →  Approval  →  Order (PO, per supplier / market run)  →  Receiving  →  Stock
-- Every PR belongs to ONE workspace (restaurant or catering) and, for catering, usually one event.
-- PRs are created three ways: by hand, from par levels (restaurant restock), or AUTOMATICALLY from an event menu.
-- =====================================================================

create type pr_status as enum ('draft', 'submitted', 'approved', 'rejected', 'ordered', 'received', 'cancelled');
create type pr_source as enum ('manual', 'event_auto', 'par_restock', 'production');

create table purchase_requests (
  id           uuid primary key default gen_random_uuid(),
  pr_no        text unique not null default next_doc_no('PR'),
  ws           workspace not null,
  event_id     uuid references events(id),
  source       pr_source not null default 'manual',
  needed_by    date,
  priority     text not null default 'normal' check (priority in ('normal', 'urgent')),
  purpose      text,
  status       pr_status not null default 'draft',
  requested_by uuid default auth.uid() references profiles(id),
  submitted_at timestamptz,
  approved_by  uuid references profiles(id),
  approved_at  timestamptz,
  decision_note text,
  created_at   timestamptz not null default now()
);
create table pr_lines (
  id            uuid primary key default gen_random_uuid(),
  pr_id         uuid not null references purchase_requests(id) on delete cascade,
  item_id       uuid not null references items(id),
  qty           numeric(12,3) not null check (qty > 0),        -- stock units
  approved_qty  numeric(12,3) check (approved_qty >= 0),
  est_unit_cost numeric(12,2) not null default 0,
  on_hand_then  numeric(12,3),                                  -- stock at the time of the request (shown to the approver)
  note          text,
  unique (pr_id, item_id)
);

create type po_status as enum ('open', 'partly_received', 'received', 'closed', 'cancelled');
create table purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  po_no       text unique not null default next_doc_no('PO'),
  ws          workspace not null,
  pr_id       uuid references purchase_requests(id),
  event_id    uuid references events(id),
  supplier_id uuid references suppliers(id),
  supplier_text text,                       -- market stall name when not a registered supplier
  buyer       uuid references profiles(id),
  advance_id  uuid,                         -- cash advance used (FK below)
  status      po_status not null default 'open',
  ordered_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create table po_lines (
  id         uuid primary key default gen_random_uuid(),
  po_id      uuid not null references purchase_orders(id) on delete cascade,
  pr_line_id uuid references pr_lines(id),
  item_id    uuid not null references items(id),
  qty        numeric(12,3) not null check (qty > 0),
  unit_cost  numeric(12,2) not null default 0
);

create table receipts (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references purchase_orders(id),
  received_by  uuid not null default auth.uid() references profiles(id),
  received_at  timestamptz not null default now(),
  or_no        text,                    -- official receipt / invoice no.
  photo_path   text,                    -- receipt photo in storage
  same_person  boolean not null default false,  -- receiver = buyer (flagged)
  short_value  numeric(12,2) not null default 0,
  price_var    numeric(12,2) not null default 0,
  note         text
);
create table receipt_lines (
  receipt_id   uuid references receipts(id) on delete cascade,
  po_line_id   uuid references po_lines(id),
  item_id      uuid not null references items(id),
  qty_received numeric(12,3) not null check (qty_received >= 0),
  unit_cost    numeric(12,2) not null,
  primary key (receipt_id, po_line_id)
);

-- ---------- cash advances & expenses ----------
create table cash_advances (
  id          uuid primary key default gen_random_uuid(),
  ws          workspace not null,
  event_id    uuid references events(id),
  given_to    uuid not null references profiles(id),
  amount      numeric(12,2) not null check (amount > 0),
  released_by uuid default auth.uid() references profiles(id),
  released_at timestamptz not null default now(),
  status      text not null default 'open' check (status in ('open', 'liquidated', 'void')),
  change_returned numeric(12,2),
  unaccounted numeric(12,2),
  liquidated_by uuid references profiles(id),
  liquidated_at timestamptz,
  note        text
);
alter table purchase_orders add constraint po_advance_fk foreign key (advance_id) references cash_advances(id);

create table expenses (
  id          uuid primary key default gen_random_uuid(),
  ws          workspace not null,
  event_id    uuid references events(id),
  spent_on    date not null default (now() at time zone 'Asia/Manila')::date,
  category    text not null,               -- fare, LPG, ice, packaging, rentals, extra helpers…
  description text,
  amount      numeric(12,2) not null check (amount > 0),
  paid_by     text,
  or_no       text,
  advance_id  uuid references cash_advances(id),
  status      text not null default 'ok' check (status in ('ok', 'void')),
  void_reason text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- AUTOMATION
-- =====================================================================

-- 1) Event menu → purchase request (the "standard purchasing list" in action)
--    Re-runnable: if the menu or guest count changes, running it again only requests the DIFFERENCE.
create or replace function generate_event_pr(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e events; pr purchase_requests; r record; already numeric; add_qty numeric; n int := 0; warn jsonb; res numeric;
begin
  perform require_role('catering', array['coordinator', 'manager', 'chef']::app_role[]);
  select * into e from events where id = p_event for update;
  if e.status in ('closed', 'cancelled', 'done') then raise exception 'Event is %', e.status; end if;
  -- reuse an open draft PR for this event; a new one is only created once there is something to buy
  select * into pr from purchase_requests where event_id = p_event and source = 'event_auto' and status = 'draft' order by created_at desc limit 1;
  for r in select * from event_requirements(p_event) loop
    -- reserve what the catering store already has for this event
    res := least(r.needed, r.free_stock);
    insert into stock_reservations(event_id, item_id, qty) values (p_event, r.item_id, res)
    on conflict (event_id, item_id) do update set qty = excluded.qty;
    -- subtract what earlier (non-cancelled) requests for this event already asked for
    select coalesce(sum(coalesce(l.approved_qty, l.qty)), 0) into already
      from pr_lines l join purchase_requests q on q.id = l.pr_id
     where q.event_id = p_event and q.id <> pr.id and q.status not in ('rejected', 'cancelled') and l.item_id = r.item_id;
    add_qty := r.to_buy - already;
    -- countable things are bought whole: 13.3 cans → 14 cans
    if add_qty > 0 and r.unit in ('pc', 'pack', 'can', 'bundle', 'bottle', 'tray', 'box', 'case') then add_qty := ceil(add_qty - 0.0001); end if;
    add_qty := round(add_qty, 3);
    if add_qty > 0 then
      if pr.id is null then
        insert into purchase_requests(ws, event_id, source, needed_by, purpose)
        values ('catering', p_event, 'event_auto', e.event_date - 1,
                'Auto from ' || e.ref || ' · ' || e.title || coalesce(' · ' || e.pax || ' guests', ''))
        returning * into pr;
      end if;
      insert into pr_lines(pr_id, item_id, qty, est_unit_cost, on_hand_then, note)
      values (pr.id, r.item_id, add_qty, (select last_cost from items where id = r.item_id), r.free_stock, 'for: ' || r.from_dishes)
      on conflict (pr_id, item_id) do update set qty = excluded.qty, est_unit_cost = excluded.est_unit_cost, on_hand_then = excluded.on_hand_then, note = excluded.note;
      n := n + 1;
    elsif pr.id is not null then
      delete from pr_lines where pr_id = pr.id and item_id = r.item_id;
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('dish', w.dish, 'problem', w.problem)), '[]') into warn from event_warnings(p_event) w;
  if pr.id is null or not exists (select 1 from pr_lines where pr_id = pr.id) then
    if pr.id is not null then delete from purchase_requests where id = pr.id; end if;
    return jsonb_build_object('pr', null, 'lines', 0, 'warnings', warn,
      'message', case when jsonb_array_length(warn) > 0 then 'Nothing to request yet for the dishes that could be calculated — fix the warnings'
                      else 'Everything needed is already in the catering store or already requested' end);
  end if;
  return jsonb_build_object('pr', pr.pr_no, 'pr_id', pr.id, 'lines', (select count(*) from pr_lines where pr_id = pr.id), 'warnings', warn);
end $$;

-- 2) Restaurant restock from par levels
create or replace function generate_par_pr(p_ws workspace default 'restaurant') returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr purchase_requests; r record; n int := 0;
begin
  perform require_role(p_ws, array['storekeeper', 'manager', 'chef']::app_role[]);
  insert into purchase_requests(ws, source, needed_by, purpose) values (p_ws, 'par_restock', (now() at time zone 'Asia/Manila')::date + 1, 'Restock to par levels')
  returning * into pr;
  for r in select p.item_id, coalesce(p.order_up_to, p.par_qty) as target, on_hand(p_ws, p.item_id) as oh, p.par_qty
           from item_par p join items i on i.id = p.item_id where p.ws = p_ws and i.active and p.par_qty > 0 loop
    if r.oh < r.par_qty then
      insert into pr_lines(pr_id, item_id, qty, est_unit_cost, on_hand_then) values (pr.id, r.item_id, round(r.target - r.oh, 3), (select last_cost from items where id = r.item_id), r.oh);
      n := n + 1;
    end if;
  end loop;
  if n = 0 then delete from purchase_requests where id = pr.id; return jsonb_build_object('pr', null, 'lines', 0); end if;
  return jsonb_build_object('pr', pr.pr_no, 'pr_id', pr.id, 'lines', n);
end $$;

-- 3) Submit, approve / reject, cancel
create or replace function submit_pr(p_pr uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr purchase_requests;
begin
  select * into pr from purchase_requests where id = p_pr for update;
  if pr.status <> 'draft' then raise exception 'Only drafts can be submitted'; end if;
  if not member_of(pr.ws) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from pr_lines where pr_id = p_pr) then raise exception 'The request has no items'; end if;
  update purchase_requests set status = 'submitted', submitted_at = now() where id = p_pr;
end $$;

create or replace function decide_pr(p_pr uuid, p_approve boolean, p_note text default null, p_qtys jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare pr purchase_requests; k text;
begin
  select * into pr from purchase_requests where id = p_pr for update;
  if pr.status <> 'submitted' then raise exception 'Only submitted requests can be decided'; end if;
  perform require_role(pr.ws, array['manager']::app_role[]);
  if pr.requested_by = auth.uid() and not is_admin() then raise exception 'You cannot approve your own request' using errcode = '42501'; end if;
  if not p_approve and coalesce(p_note, '') = '' then raise exception 'Give a reason for rejecting'; end if;
  if p_approve then
    update pr_lines set approved_qty = qty where pr_id = p_pr;
    if p_qtys is not null then        -- {"<pr_line_id>": 4.5, …} lower quantities
      for k in select jsonb_object_keys(p_qtys) loop
        update pr_lines set approved_qty = least(qty, greatest((p_qtys->>k)::numeric, 0)) where id = k::uuid and pr_id = p_pr;
      end loop;
    end if;
  end if;
  update purchase_requests set status = case when p_approve then 'approved'::pr_status else 'rejected'::pr_status end,
         approved_by = auth.uid(), approved_at = now(), decision_note = p_note where id = p_pr;
end $$;

-- 4) Approved request → purchase order(s). Call once per supplier / market run with the lines bought there (or all remaining).
create or replace function create_po(p_pr uuid, p_supplier uuid default null, p_supplier_text text default null, p_buyer uuid default null, p_line_ids uuid[] default null, p_advance uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare pr purchase_requests; po purchase_orders; n int;
begin
  select * into pr from purchase_requests where id = p_pr for update;
  if pr.status not in ('approved', 'ordered') then raise exception 'Request must be approved first'; end if;
  perform require_role(pr.ws, array['purchaser', 'manager', 'finance']::app_role[]);
  insert into purchase_orders(ws, pr_id, event_id, supplier_id, supplier_text, buyer, advance_id)
  values (pr.ws, pr.id, pr.event_id, p_supplier, p_supplier_text, coalesce(p_buyer, auth.uid()), p_advance) returning * into po;
  insert into po_lines(po_id, pr_line_id, item_id, qty, unit_cost)
  select po.id, l.id, l.item_id, l.approved_qty - coalesce((select sum(pl.qty) from po_lines pl join purchase_orders o on o.id = pl.po_id where pl.pr_line_id = l.id and o.status <> 'cancelled'), 0), l.est_unit_cost
  from pr_lines l where l.pr_id = p_pr and coalesce(l.approved_qty, 0) > 0 and (p_line_ids is null or l.id = any(p_line_ids))
    and l.approved_qty - coalesce((select sum(pl.qty) from po_lines pl join purchase_orders o on o.id = pl.po_id where pl.pr_line_id = l.id and o.status <> 'cancelled'), 0) > 0;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nothing left to order on this request'; end if;
  update purchase_requests set status = 'ordered' where id = p_pr;
  return po.po_no;
end $$;

-- 5) Receiving: weigh/count what actually arrived. Only received quantities enter stock.
--    p_lines: [{"po_line_id": "...", "qty": 4.5, "unit_cost": 360}]
create or replace function receive_po(p_po uuid, p_lines jsonb, p_or_no text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare po purchase_orders; rc receipts; l jsonb; pl po_lines; q numeric; c numeric; shortv numeric := 0; pricev numeric := 0; got numeric; due numeric;
begin
  select * into po from purchase_orders where id = p_po for update;
  if po.status not in ('open', 'partly_received') then raise exception 'Order is %', po.status; end if;
  perform require_role(po.ws, array['storekeeper', 'manager', 'chef']::app_role[]);
  insert into receipts(po_id, or_no, note, same_person) values (p_po, p_or_no, p_note, po.buyer = auth.uid()) returning * into rc;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into pl from po_lines where id = (l->>'po_line_id')::uuid and po_id = p_po;
    if pl.id is null then raise exception 'Line not on this order'; end if;
    q := coalesce((l->>'qty')::numeric, 0); c := coalesce((l->>'unit_cost')::numeric, pl.unit_cost);
    insert into receipt_lines(receipt_id, po_line_id, item_id, qty_received, unit_cost) values (rc.id, pl.id, pl.item_id, q, c);
    if q > 0 then
      insert into stock_moves(ws, item_id, kind, qty, unit_cost, event_id, ref_type, ref_id)
      values (po.ws, pl.item_id, 'receipt', q, c, po.event_id, 'receipt', rc.id::text);
      update items set last_cost = c where id = pl.item_id and c > 0;
      -- stock bought for an event is reserved for it
      if po.event_id is not null then
        insert into stock_reservations(event_id, item_id, qty) values (po.event_id, pl.item_id, q)
        on conflict (event_id, item_id) do update set qty = stock_reservations.qty + excluded.qty;
      end if;
    end if;
    select coalesce(sum(qty_received), 0) into got from receipt_lines where po_line_id = pl.id;
    if got < pl.qty then shortv := shortv + (pl.qty - got) * c; end if;
    if pl.unit_cost > 0 and c <> pl.unit_cost then pricev := pricev + (c - pl.unit_cost) * q; end if;
  end loop;
  -- order fully received?
  select coalesce(sum(greatest(pl2.qty - coalesce((select sum(rl.qty_received) from receipt_lines rl where rl.po_line_id = pl2.id), 0), 0)), 0)
    into due from po_lines pl2 where pl2.po_id = p_po;
  update purchase_orders set status = case when due <= 0.0005 then 'received'::po_status else 'partly_received'::po_status end where id = p_po;
  update receipts set short_value = round(shortv, 2), price_var = round(pricev, 2) where id = rc.id;
  if due <= 0.0005 and not exists (select 1 from purchase_orders o where o.pr_id = po.pr_id and o.status in ('open', 'partly_received')) then
    update purchase_requests set status = 'received' where id = po.pr_id
      and not exists (select 1 from pr_lines l where l.pr_id = po.pr_id and coalesce(l.approved_qty, 0) >
                      coalesce((select sum(pl3.qty) from po_lines pl3 join purchase_orders o3 on o3.id = pl3.po_id where pl3.pr_line_id = l.id and o3.status <> 'cancelled'), 0));
  end if;
  return jsonb_build_object('receipt', rc.id, 'short_value', round(shortv, 2), 'price_variance', round(pricev, 2), 'same_person', rc.same_person, 'order_status', (select status from purchase_orders where id = p_po));
end $$;

-- 6) Catering prep day: issue stock to the event; leftovers come back as returns
create or replace function issue_to_event(p_event uuid, p_lines jsonb, p_received_by text, p_return boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare l jsonb; q numeric; it items; n int := 0;
begin
  perform require_role('catering', array['storekeeper', 'manager', 'chef']::app_role[]);
  if coalesce(p_received_by, '') = '' then raise exception 'Name the person who received the stock'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric; if q is null or q <= 0 then continue; end if;
    select * into it from items where id = (l->>'item_id')::uuid;
    insert into stock_moves(ws, item_id, kind, qty, unit_cost, event_id, ref_type, note)
    values ('catering', it.id, case when p_return then 'return'::move_kind else 'issue'::move_kind end, case when p_return then q else -q end,
            it.last_cost, p_event, 'event', (case when p_return then 'returned by ' else 'received by ' end) || p_received_by);
    if not p_return then
      update stock_reservations set qty = greatest(qty - q, 0) where event_id = p_event and item_id = it.id;
    end if;
    n := n + 1;
  end loop;
  if not p_return then update events set status = 'in_prep' where id = p_event and status = 'confirmed'; end if;
  return n;
end $$;

-- Pick list for prep day = what is reserved for the event in the catering store
create or replace view event_pick_list with (security_invoker = true) as
select r.event_id, i.id as item_id, i.name, i.stock_unit, r.qty as reserved, on_hand('catering', i.id) as in_store
from stock_reservations r join items i on i.id = r.item_id where r.qty > 0;

-- Close an event: release leftover reservations, freeze the cost
create or replace function close_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role('catering', array['manager', 'finance']::app_role[]);
  delete from stock_reservations where event_id = p_event;
  update events set status = 'closed' where id = p_event;
end $$;

-- Event costing: contract price vs ingredients actually used + event expenses
create or replace view event_costing with (security_invoker = true) as
select e.id as event_id, e.ref, e.title, e.event_date, e.pax, e.contract_price,
       coalesce(-sum(m.qty * m.unit_cost) filter (where m.kind in ('issue', 'return')), 0)::numeric(12,2) as ingredients_used,
       coalesce((select sum(x.amount) from expenses x where x.event_id = e.id and x.status = 'ok'), 0)::numeric(12,2) as expenses,
       (coalesce(-sum(m.qty * m.unit_cost) filter (where m.kind in ('issue', 'return')), 0)
        + coalesce((select sum(x.amount) from expenses x where x.event_id = e.id and x.status = 'ok'), 0))::numeric(12,2) as total_cost
from events e left join stock_moves m on m.event_id = e.id and m.ws = 'catering'
group by e.id;

-- 7) Cash advances: liquidation must balance
create or replace function liquidate_advance(p_adv uuid, p_change numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a cash_advances; spent numeric; diff numeric;
begin
  select * into a from cash_advances where id = p_adv for update;
  if a.status <> 'open' then raise exception 'Advance is %', a.status; end if;
  if p_change is null or p_change < 0 then raise exception 'Enter the cash actually returned (0 or more)'; end if;
  perform require_role(a.ws, array['finance', 'manager', 'cashier']::app_role[]);
  select coalesce(sum(rl.qty_received * rl.unit_cost), 0) into spent
    from receipt_lines rl join receipts r on r.id = rl.receipt_id join purchase_orders o on o.id = r.po_id where o.advance_id = p_adv;
  spent := spent + coalesce((select sum(amount) from expenses where advance_id = p_adv and status = 'ok'), 0);
  diff := round(a.amount - spent - p_change, 2);
  if abs(diff) >= 1 and coalesce(p_note, '') = '' then raise exception 'Does not balance by % — add an explanation', diff; end if;
  update cash_advances set status = 'liquidated', change_returned = p_change, unaccounted = diff, liquidated_by = auth.uid(), liquidated_at = now(),
         note = concat_ws(' · ', note, p_note) where id = p_adv;
  return jsonb_build_object('spent', round(spent, 2), 'unaccounted', diff);
end $$;
