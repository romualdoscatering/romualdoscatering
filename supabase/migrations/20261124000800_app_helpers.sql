-- =====================================================================
-- Romualdo's Platform · 08 · Helpers for the staff app
-- =====================================================================

-- Owner gives a login its name and roles. The login itself is created first in
-- Supabase → Authentication → Add user (a browser key cannot create logins).
-- p_roles: [{"ws":"catering","role":"chef"}, {"ws":"restaurant","role":"chef"}]
create or replace function admin_set_member(p_email text, p_username text, p_full_name text, p_roles jsonb default '[]',
                                            p_is_admin boolean default false, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid; r jsonb;
begin
  if not is_admin() then raise exception 'Only the owner can change people and roles' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(trim(email)) = lower(trim(p_email));
  if uid is null then raise exception 'No login with the email %. Add it first in Supabase → Authentication → Add user.', p_email; end if;
  if uid = auth.uid() and (not p_is_admin or not p_active) then raise exception 'You cannot remove your own owner access'; end if;
  insert into profiles(id, username, full_name, is_admin, active)
  values (uid, lower(trim(p_username)), trim(p_full_name), p_is_admin, p_active)
  on conflict (id) do update set username = excluded.username, full_name = excluded.full_name, is_admin = excluded.is_admin, active = excluded.active;
  delete from memberships where user_id = uid;
  for r in select * from jsonb_array_elements(coalesce(p_roles, '[]')) loop
    insert into memberships(user_id, ws, role) values (uid, (r->>'ws')::workspace, (r->>'role')::app_role) on conflict do nothing;
  end loop;
  return uid;
end $$;

-- People list for the owner, with their login email
create or replace function admin_people() returns table (id uuid, email text, username text, full_name text, is_admin boolean, active boolean, roles jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the owner can see this' using errcode = '42501'; end if;
  return query
  select u.id, u.email::text, p.username, p.full_name, coalesce(p.is_admin, false), coalesce(p.active, false),
         coalesce((select jsonb_agg(jsonb_build_object('ws', m.ws, 'role', m.role) order by m.ws, m.role) from memberships m where m.user_id = u.id), '[]')
  from auth.users u left join profiles p on p.id = u.id
  order by p.full_name nulls first, u.email;
end $$;

-- What the logged-in person may do (used by the app to show the right buttons; the database still checks every action)
create or replace function my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'full_name', p.full_name, 'is_admin', p.is_admin, 'active', p.active,
    'roles', coalesce((select jsonb_agg(jsonb_build_object('ws', m.ws, 'role', m.role)) from memberships m where m.user_id = p.id), '[]'))
  from profiles p where p.id = auth.uid()
$$;

-- Request list with totals and names
create or replace view pr_overview with (security_invoker = true) as
select r.id, r.pr_no, r.ws, r.event_id, e.ref as event_ref, e.title as event_title, r.source, r.needed_by, r.priority, r.purpose, r.status,
       r.requested_by, rp.full_name as requested_by_name, r.approved_by, ap.full_name as approved_by_name, r.approved_at, r.decision_note,
       r.created_at, r.submitted_at,
       (select count(*) from pr_lines l where l.pr_id = r.id) as line_count,
       (select coalesce(sum(coalesce(l.approved_qty, l.qty) * l.est_unit_cost), 0) from pr_lines l where l.pr_id = r.id)::numeric(12,2) as est_total
from purchase_requests r
left join events e on e.id = r.event_id
left join profiles rp on rp.id = r.requested_by
left join profiles ap on ap.id = r.approved_by;

-- Order list with progress
create or replace view po_overview with (security_invoker = true) as
select o.id, o.po_no, o.ws, o.pr_id, r.pr_no, o.event_id, e.ref as event_ref, e.title as event_title, o.status, o.ordered_at,
       coalesce(s.name, o.supplier_text) as supplier, o.buyer, bp.full_name as buyer_name, o.advance_id,
       (select count(*) from po_lines pl where pl.po_id = o.id) as line_count,
       (select coalesce(sum(pl.qty * pl.unit_cost), 0) from po_lines pl where pl.po_id = o.id)::numeric(12,2) as ordered_value,
       (select coalesce(sum(rl.qty_received * rl.unit_cost), 0) from receipts rc join receipt_lines rl on rl.receipt_id = rc.id where rc.po_id = o.id)::numeric(12,2) as received_value
from purchase_orders o
left join purchase_requests r on r.id = o.pr_id
left join events e on e.id = o.event_id
left join suppliers s on s.id = o.supplier_id
left join profiles bp on bp.id = o.buyer;

-- Order lines with what has been received so far
create or replace view po_line_progress with (security_invoker = true) as
select pl.id, pl.po_id, pl.item_id, i.name, i.stock_unit, pl.qty as ordered, pl.unit_cost,
       coalesce((select sum(rl.qty_received) from receipt_lines rl where rl.po_line_id = pl.id), 0) as received
from po_lines pl join items i on i.id = pl.item_id;

grant select on pr_overview, po_overview, po_line_progress to authenticated;
revoke execute on function admin_set_member(text, text, text, jsonb, boolean, boolean), admin_people(), my_access() from public, anon;
grant execute on function admin_set_member(text, text, text, jsonb, boolean, boolean), admin_people(), my_access() to authenticated;

-- An open count's witness and note can be filled in while counting (posting still only through post_count)
create policy "edit open count" on stock_counts for update
  using (status = 'open' and has_role(ws, array['storekeeper', 'manager', 'chef']::app_role[]))
  with check (status = 'open' and posted_at is null and loss_value is null and gain_value is null);
