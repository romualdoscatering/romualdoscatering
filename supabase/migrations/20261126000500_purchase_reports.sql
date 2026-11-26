-- "Record what was bought": the buyer reports on the approved request itself — everything is ticked as bought,
-- they untick what wasn't, adjust quantities and prices — and submit. A manager or storekeeper approves it, and only
-- then do the bought items enter stock (through the usual order + receiving, so stock, last prices and the event's
-- reserved stock update exactly as before). Unbought items stay on the request as "still to buy".
begin;
create table if not exists purchase_reports (
  id            uuid primary key default gen_random_uuid(),
  pr_id         uuid not null references purchase_requests(id) on delete cascade,
  ws            workspace not null,
  status        text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  supplier_text text,
  or_no         text,
  note          text,
  submitted_by  uuid not null default auth.uid() references profiles(id),
  submitted_at  timestamptz not null default now(),
  decided_by    uuid references profiles(id),
  decided_at    timestamptz,
  decision_note text,
  po_id         uuid references purchase_orders(id)
);
create unique index if not exists purchase_reports_one_pending on purchase_reports(pr_id) where status = 'submitted';
create table if not exists purchase_report_lines (
  report_id  uuid not null references purchase_reports(id) on delete cascade,
  pr_line_id uuid not null references pr_lines(id) on delete cascade,
  bought     boolean not null default true,
  qty        numeric(12,3) not null default 0 check (qty >= 0),       -- stock units actually bought
  unit_cost  numeric(12,2) not null default 0 check (unit_cost >= 0), -- actual price per stock unit
  primary key (report_id, pr_line_id)
);
alter table purchase_reports enable row level security;
alter table purchase_report_lines enable row level security;
drop policy if exists "read" on purchase_reports;
create policy "read" on purchase_reports for select using (member_of(ws));
drop policy if exists "read" on purchase_report_lines;
create policy "read" on purchase_report_lines for select using (exists (select 1 from purchase_reports r where r.id = report_id and member_of(r.ws)));
grant select on purchase_reports, purchase_report_lines to authenticated;   -- changes only through the functions below
revoke insert, update, delete on purchase_reports, purchase_report_lines from authenticated;
drop trigger if exists audit on purchase_reports;
create trigger audit after insert or update or delete on purchase_reports for each row execute function audit_trigger();

-- p_lines: [{"pr_line_id": "...", "bought": true, "qty": 2.5, "unit_cost": 180}]
create or replace function submit_purchase_report(p_pr uuid, p_lines jsonb, p_supplier text default null, p_or_no text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pr purchase_requests; rep uuid; l jsonb; pl pr_lines; b boolean; q numeric; c numeric; n int := 0;
begin
  select * into pr from purchase_requests where id = p_pr for update;
  if pr.id is null then raise exception 'Request not found.'; end if;
  if pr.status not in ('approved', 'ordered') then raise exception '% must be approved before recording what was bought.', pr.pr_no; end if;
  perform require_role(pr.ws, array['purchaser', 'manager', 'finance', 'storekeeper', 'chef', 'coordinator']::app_role[]);
  if exists (select 1 from purchase_reports where pr_id = p_pr and status = 'submitted') then
    raise exception 'A purchase report for % is already waiting for approval.', pr.pr_no;
  end if;
  insert into purchase_reports(pr_id, ws, supplier_text, or_no, note) values (p_pr, pr.ws, nullif(trim(p_supplier), ''), nullif(trim(p_or_no), ''), nullif(trim(p_note), ''))
  returning id into rep;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into pl from pr_lines where id = (l->>'pr_line_id')::uuid and pr_id = p_pr;
    if pl.id is null then raise exception 'An item is not on this request.'; end if;
    b := coalesce((l->>'bought')::boolean, true); q := coalesce((l->>'qty')::numeric, 0); c := coalesce((l->>'unit_cost')::numeric, pl.est_unit_cost);
    if b and q <= 0 then raise exception 'Enter how much of % was bought, or untick it.', (select name from items where id = pl.item_id); end if;
    if q < 0 or c < 0 then raise exception 'Quantities and prices cannot be negative.'; end if;
    insert into purchase_report_lines(report_id, pr_line_id, bought, qty, unit_cost) values (rep, pl.id, b, case when b then q else 0 end, c);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Nothing to report.'; end if;
  return rep;
end $$;

-- Approve: bought lines become an order that is received in full at the reported quantities and prices → stock.
-- p_close: the unbought items won't be bought — close the request instead of leaving them "still to buy".
create or replace function decide_purchase_report(p_report uuid, p_approve boolean, p_note text default null, p_close boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r purchase_reports; pr purchase_requests; v_po uuid; lines jsonb; res jsonb := '{}'::jsonb; nb int;
begin
  select * into r from purchase_reports where id = p_report for update;
  if r.id is null then raise exception 'Purchase report not found.'; end if;
  if r.status <> 'submitted' then raise exception 'This purchase report was already %.', r.status; end if;
  if not has_role(r.ws, array['manager', 'storekeeper']::app_role[]) then raise exception 'Only a manager or storekeeper can approve purchases into stock.'; end if;
  if r.submitted_by = auth.uid() and not is_admin() then raise exception 'You recorded these purchases, so someone else must check and approve them.'; end if;
  select * into pr from purchase_requests where id = r.pr_id for update;
  if not p_approve then
    update purchase_reports set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = r.id;
    return jsonb_build_object('status', 'rejected');
  end if;
  select count(*) into nb from purchase_report_lines where report_id = r.id and bought and qty > 0;
  if nb > 0 then
    insert into purchase_orders(ws, pr_id, event_id, supplier_text, buyer)
    values (r.ws, r.pr_id, pr.event_id, coalesce(r.supplier_text, 'Purchase report'), r.submitted_by) returning id into v_po;
    insert into po_lines(po_id, pr_line_id, item_id, qty, unit_cost)
    select v_po, rl.pr_line_id, pl.item_id, rl.qty, rl.unit_cost
    from purchase_report_lines rl join pr_lines pl on pl.id = rl.pr_line_id where rl.report_id = r.id and rl.bought and rl.qty > 0;
    update purchase_requests set status = 'ordered' where id = r.pr_id and status = 'approved';
    select jsonb_agg(jsonb_build_object('po_line_id', x.id, 'qty', x.qty, 'unit_cost', x.unit_cost)) into lines from po_lines x where x.po_id = v_po;
    res := receive_po(v_po, lines, r.or_no, coalesce(r.note, 'From purchase report'));
  end if;
  update purchase_reports set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''), po_id = v_po where id = r.id;
  -- everything approved has now been bought (or they chose to stop buying the rest) → the request is done
  if p_close or not exists (select 1 from pr_lines l where l.pr_id = r.pr_id and coalesce(l.approved_qty, 0) >
       coalesce((select sum(x.qty) from po_lines x join purchase_orders o on o.id = x.po_id where x.pr_line_id = l.id and o.status <> 'cancelled'), 0)) then
    update purchase_requests set status = 'received' where id = r.pr_id;
  end if;
  return res || jsonb_build_object('status', 'approved', 'bought_lines', nb, 'request_status', (select status from purchase_requests where id = r.pr_id));
end $$;

-- The person who recorded it can take it back while it is waiting (to fix a mistake and submit again)
create or replace function withdraw_purchase_report(p_report uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r purchase_reports;
begin
  select * into r from purchase_reports where id = p_report for update;
  if r.id is null or r.status <> 'submitted' then raise exception 'Only a report still waiting for approval can be withdrawn.'; end if;
  if r.submitted_by <> auth.uid() and not has_role(r.ws, array['manager']::app_role[]) then raise exception 'Only the person who recorded it, or a manager, can withdraw it.'; end if;
  delete from purchase_reports where id = r.id;
end $$;

revoke execute on function submit_purchase_report(uuid, jsonb, text, text, text), decide_purchase_report(uuid, boolean, text, boolean), withdraw_purchase_report(uuid) from public, anon;
grant execute on function submit_purchase_report(uuid, jsonb, text, text, text), decide_purchase_report(uuid, boolean, text, boolean), withdraw_purchase_report(uuid) to authenticated;
commit;
