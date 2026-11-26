-- Delete purchase requests made in error, duplicated, or overtaken by a revised event/client order.
--   * whoever filed it: while it is a draft, waiting for approval, rejected or cancelled
--   * managers of that side (catering/restaurant) and the owner: also once approved
--   * nobody, once an order (PO) has been placed from it — cancel the order first, so the books stay whole
-- Several at once is all-or-nothing: if one can't go, none are deleted and the message names it.
-- The audit log keeps a copy of every deleted request.
begin;
create or replace function delete_prs(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare r purchase_requests; n int := 0;
begin
  for r in select * from purchase_requests where id = any(p_ids) order by pr_no for update loop
    if not member_of(r.ws) then raise exception '% belongs to the other side of the business.', r.pr_no; end if;
    if r.status in ('ordered', 'received')
       or exists (select 1 from purchase_orders where pr_id = r.id and status <> 'cancelled') then
      raise exception '% already has an order placed. Cancel the order first, then delete the request.', r.pr_no;
    end if;
    if not (is_admin() or has_role(r.ws, array['manager']::app_role[])
            or (r.requested_by = auth.uid() and r.status in ('draft', 'submitted', 'rejected', 'cancelled'))) then
      raise exception '% can only be deleted by the person who filed it (before approval) or a manager.', r.pr_no;
    end if;
    -- cancelled orders stay as history, just no longer linked to the request
    update po_lines set pr_line_id = null where pr_line_id in (select id from pr_lines where pr_id = r.id);
    update purchase_orders set pr_id = null where pr_id = r.id;
    delete from purchase_requests where id = r.id;   -- its lines go with it
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function delete_prs(uuid[]) to authenticated;
revoke execute on function delete_prs(uuid[]) from anon;
commit;
