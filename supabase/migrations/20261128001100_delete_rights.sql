-- Who can delete:
--   Events: anyone in catering while not yet approved by the client; after approval the owner, catering managers and event specialists.
--   Website inquiries (bookings): the owner, catering managers and event specialists.
-- Events with money, orders or stock attached still can't be deleted (set them to Cancelled, or merge duplicates).
-- A full copy of every deleted event or inquiry is kept in the activity log.

create or replace function event_admin() returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or has_role('catering', array['manager', 'event_specialist']::app_role[])
$$;

create or replace function delete_event(p_event uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e events; why text;
begin
  select * into e from events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if not member_of('catering') then raise exception 'Only the catering team can delete events'; end if;
  if e.status not in ('inquiry', 'draft', 'for_client_approval') and not event_admin() then
    raise exception 'This event is already approved by the client. Only the owner, a catering manager or an event specialist can delete it, or set its status to Cancelled.';
  end if;
  why := concat_ws(', ',
    case when exists (select 1 from stock_moves where event_id = p_event) then 'stock was set aside, issued or returned' end,
    case when exists (select 1 from purchase_orders where event_id = p_event) then 'orders were placed' end,
    case when exists (select 1 from purchase_requests where event_id = p_event and status not in ('draft', 'rejected', 'cancelled')) then 'a purchase request was submitted' end,
    case when exists (select 1 from event_payments where event_id = p_event) then 'payments were recorded' end,
    case when exists (select 1 from cash_advances where event_id = p_event) then 'a cash advance was made' end,
    case when exists (select 1 from expenses where event_id = p_event) then 'expenses were recorded' end);
  if why <> '' then raise exception 'This event can''t be deleted because %. Set its status to Cancelled instead, or merge it on the Duplicate events page.', why; end if;
  perform event_snapshot(p_event, 'DELETE_EVENT', null);
  delete from purchase_requests where event_id = p_event;
  update bookings set event_id = null where event_id = p_event;
  delete from events where id = p_event;
  return e.ref;
end $$;
grant execute on function delete_event(uuid) to authenticated;

create or replace function delete_booking(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  if not event_admin() then raise exception 'Only the owner, a catering manager or an event specialist can delete inquiries' using errcode = '42501'; end if;
  select * into b from bookings where id = p_id for update;
  if not found then raise exception 'Inquiry not found'; end if;
  insert into audit_log(actor, tbl, row_id, action, old_row) values (auth.uid(), 'bookings', b.id::text, 'DELETE_INQUIRY', to_jsonb(b));
  update events set booking_id = null where booking_id = p_id;
  delete from bookings where id = p_id;
  return coalesce(b.ref, b.website_ref, 'Inquiry');
end $$;
grant execute on function delete_booking(uuid) to authenticated;
