-- =====================================================================
-- Romualdo's Platform · 07 · Security (row-level security) and audit
-- Rule of thumb:
--   * You only SEE the workspace(s) you belong to (admins see both).
--   * Stock, approvals, orders, receiving and liquidations can only change
--     through the workflow functions above — never by editing rows directly.
--   * Nothing financial is deleted; it is voided or cancelled, and every
--     change lands in audit_log with who and when.
-- =====================================================================

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------- people ----------
create policy "people: active users see colleagues" on profiles for select using (is_active_user());
create policy "people: admin manages" on profiles for all using (is_admin()) with check (is_admin());
create policy "people: edit own name/phone" on profiles for update using (id = auth.uid()) with check (id = auth.uid() and is_admin = (select p.is_admin from profiles p where p.id = auth.uid()) and active);
create policy "roles: see own" on memberships for select using (user_id = auth.uid() or is_admin());
create policy "roles: admin manages" on memberships for all using (is_admin()) with check (is_admin());

-- ---------- master data (shared by both workspaces) ----------
create policy "read" on suppliers for select using (is_active_user());
create policy "write" on suppliers for all using (has_role_any(array['manager', 'purchaser', 'finance']::app_role[])) with check (has_role_any(array['manager', 'purchaser', 'finance']::app_role[]));
create policy "read" on items for select using (is_active_user());
create policy "add" on items for insert with check (has_role_any(array['manager', 'purchaser', 'storekeeper', 'chef']::app_role[]));
create policy "edit" on items for update using (has_role_any(array['manager', 'chef']::app_role[]));
create policy "read" on item_par for select using (member_of(ws));
create policy "write" on item_par for all using (has_role(ws, array['manager', 'chef']::app_role[])) with check (has_role(ws, array['manager', 'chef']::app_role[]));
create policy "read" on dishes for select using (is_active_user());
create policy "write" on dishes for all using (has_role_any(array['manager', 'chef', 'coordinator']::app_role[])) with check (has_role_any(array['manager', 'chef', 'coordinator']::app_role[]));
create policy "read" on dish_aliases for select using (is_active_user());
create policy "write" on dish_aliases for all using (has_role_any(array['manager', 'chef', 'coordinator']::app_role[])) with check (has_role_any(array['manager', 'chef', 'coordinator']::app_role[]));
create policy "read" on recipes for select using (is_active_user());
create policy "write" on recipes for all using (has_role_any(array['manager', 'chef']::app_role[])) with check (has_role_any(array['manager', 'chef']::app_role[]) and (status = 'draft' or verified_by = auth.uid()));
create policy "read" on recipe_lines for select using (is_active_user());
create policy "write" on recipe_lines for all using (has_role_any(array['manager', 'chef']::app_role[])) with check (has_role_any(array['manager', 'chef']::app_role[]));
create policy "read" on course_rules for select using (is_active_user());
create policy "write" on course_rules for all using (has_role('catering', array['manager']::app_role[])) with check (has_role('catering', array['manager']::app_role[]));
create policy "read" on pack_sets for select using (is_active_user());
create policy "write" on pack_sets for all using (has_role('catering', array['manager', 'coordinator', 'chef']::app_role[])) with check (has_role('catering', array['manager', 'coordinator', 'chef']::app_role[]));
create policy "read" on pack_components for select using (is_active_user());
create policy "write" on pack_components for all using (has_role('catering', array['manager', 'coordinator', 'chef']::app_role[])) with check (has_role('catering', array['manager', 'coordinator', 'chef']::app_role[]));

-- ---------- stock (ledger is function-only) ----------
create policy "read" on stock_moves for select using (member_of(ws));
create policy "read" on stock_counts for select using (member_of(ws));
create policy "start" on stock_counts for insert with check (has_role(ws, array['storekeeper', 'manager', 'chef']::app_role[]) and status = 'open');
create policy "read" on stock_count_lines for select using (exists (select 1 from stock_counts c where c.id = count_id and member_of(c.ws)));
create policy "count" on stock_count_lines for all
  using (exists (select 1 from stock_counts c where c.id = count_id and c.status = 'open' and has_role(c.ws, array['storekeeper', 'manager', 'chef']::app_role[])))
  with check (expected is null and exists (select 1 from stock_counts c where c.id = count_id and c.status = 'open' and has_role(c.ws, array['storekeeper', 'manager', 'chef']::app_role[])));

-- ---------- catering ----------
create policy "read" on clients for select using (member_of('catering'));
create policy "write" on clients for all using (has_role('catering', array['coordinator', 'manager', 'finance']::app_role[])) with check (has_role('catering', array['coordinator', 'manager', 'finance']::app_role[]));
create policy "read" on bookings for select using (member_of('catering'));
create policy "handle" on bookings for update using (has_role('catering', array['coordinator', 'manager']::app_role[]));
create policy "read" on events for select using (member_of('catering'));
create policy "write" on events for insert with check (has_role('catering', array['coordinator', 'manager']::app_role[]));
create policy "edit" on events for update using (has_role('catering', array['coordinator', 'manager', 'finance']::app_role[]) and status <> 'closed')
  with check (status <> 'closed' or has_role('catering', array['manager', 'finance']::app_role[]));
create policy "read" on event_menu for select using (member_of('catering'));
create policy "write" on event_menu for all
  using (has_role('catering', array['coordinator', 'manager', 'chef']::app_role[]) and exists (select 1 from events e where e.id = event_id and e.status not in ('done', 'closed', 'cancelled')))
  with check (has_role('catering', array['coordinator', 'manager', 'chef']::app_role[]) and exists (select 1 from events e where e.id = event_id and e.status not in ('done', 'closed', 'cancelled')));
create policy "read" on event_extra_needs for select using (member_of('catering'));
create policy "write" on event_extra_needs for all using (has_role('catering', array['chef', 'manager']::app_role[])) with check (has_role('catering', array['chef', 'manager']::app_role[]));
create policy "read" on stock_reservations for select using (member_of('catering'));

-- ---------- purchasing ----------
create policy "read" on purchase_requests for select using (member_of(ws));
create policy "file" on purchase_requests for insert with check (member_of(ws) and status = 'draft' and requested_by = auth.uid());
create policy "edit draft" on purchase_requests for update using (status = 'draft' and (requested_by = auth.uid() or has_role(ws, array['manager']::app_role[])))
  with check (status = 'draft');
create policy "read" on pr_lines for select using (exists (select 1 from purchase_requests p where p.id = pr_id and member_of(p.ws)));
create policy "edit draft" on pr_lines for all
  using (exists (select 1 from purchase_requests p where p.id = pr_id and p.status = 'draft' and (p.requested_by = auth.uid() or has_role(p.ws, array['manager']::app_role[]))))
  with check (approved_qty is null and exists (select 1 from purchase_requests p where p.id = pr_id and p.status = 'draft' and (p.requested_by = auth.uid() or has_role(p.ws, array['manager']::app_role[]))));
create policy "read" on purchase_orders for select using (member_of(ws));
create policy "read" on po_lines for select using (exists (select 1 from purchase_orders o where o.id = po_id and member_of(o.ws)));
create policy "read" on receipts for select using (exists (select 1 from purchase_orders o where o.id = po_id and member_of(o.ws)));
create policy "attach photo / OR" on receipts for update using (received_by = auth.uid() or exists (select 1 from purchase_orders o where o.id = po_id and has_role(o.ws, array['manager', 'finance']::app_role[])));
create policy "read" on receipt_lines for select using (exists (select 1 from receipts r join purchase_orders o on o.id = r.po_id where r.id = receipt_id and member_of(o.ws)));
create policy "read" on cash_advances for select using (member_of(ws));
create policy "release" on cash_advances for insert with check (has_role(ws, array['finance', 'manager', 'cashier']::app_role[]) and status = 'open');
create policy "read" on expenses for select using (member_of(ws));
create policy "record" on expenses for insert with check (member_of(ws) and status = 'ok');
create policy "void" on expenses for update using (has_role(ws, array['manager', 'finance']::app_role[]));

-- ---------- restaurant ----------
create policy "read" on daily_sales for select using (member_of('restaurant'));
create policy "write" on daily_sales for all using (has_role('restaurant', array['cashier', 'manager', 'finance']::app_role[])) with check (has_role('restaurant', array['cashier', 'manager', 'finance']::app_role[]));
create policy "read" on dish_day_counts for select using (member_of('restaurant'));
create policy "write" on dish_day_counts for all using (member_of('restaurant')) with check (member_of('restaurant'));

-- ---------- HR & audit ----------
create policy "read" on employees for select using (is_admin() or has_role_any(array['finance', 'manager']::app_role[]) or profile_id = auth.uid());
create policy "write" on employees for all using (is_admin() or has_role_any(array['finance']::app_role[])) with check (is_admin() or has_role_any(array['finance']::app_role[]));
create policy "read" on time_punches for select using (is_admin() or has_role_any(array['finance', 'manager']::app_role[]) or exists (select 1 from employees e where e.id = employee_id and e.profile_id = auth.uid()));
create policy "admin" on audit_log for select using (is_admin());
-- doc_counters: no policies → only reachable through next_doc_no()

-- ---------- audit triggers on everything that touches money or stock ----------
do $$ declare t text; begin
  foreach t in array array['profiles', 'memberships', 'items', 'recipes', 'recipe_lines', 'events', 'event_menu', 'purchase_requests', 'pr_lines',
                           'purchase_orders', 'receipts', 'cash_advances', 'expenses', 'stock_counts', 'daily_sales', 'employees'] loop
    execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_trigger()', t);
  end loop;
end $$;

-- ---------- function access ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function submit_booking(jsonb) to anon;
-- role checks simply answer "no" for visitors, so they see empty results instead of errors
grant execute on function is_admin(), is_active_user(), member_of(workspace), has_role(workspace, app_role[]), has_role_any(app_role[]) to anon;
revoke all on doc_counters, audit_log from anon;
