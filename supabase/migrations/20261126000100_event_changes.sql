-- Who last changed each event, and when: the event's own details, its menu and its off-menu ingredients.
-- The staff app uses it to show "Last changed by …", to refresh an open event when someone else saves,
-- and to stop a save from silently overwriting someone else's newer changes.
begin;
alter table events add column if not exists updated_at timestamptz;
alter table events add column if not exists updated_by uuid references profiles(id);
update events set updated_at = created_at, updated_by = created_by where updated_at is null;
alter table events alter column updated_at set default now(), alter column updated_at set not null,
                   alter column updated_by set default auth.uid();

-- Any real change to an event row stamps it (a save that changes nothing leaves the stamp alone)
create or replace function events_touch() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'updated_by') is distinct from (to_jsonb(old) - 'updated_at' - 'updated_by') then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end $$;
drop trigger if exists touch on events;
create trigger touch before update on events for each row execute function events_touch();

-- Menu and off-menu ingredient changes stamp their event too
create or replace function event_child_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update events set updated_at = now(), updated_by = coalesce(auth.uid(), updated_by)
  where id = case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  return null;
end $$;
drop trigger if exists touch_event on event_menu;
create trigger touch_event after insert or update or delete on event_menu for each row execute function event_child_touch();
drop trigger if exists touch_event on event_extra_needs;
create trigger touch_event after insert or update or delete on event_extra_needs for each row execute function event_child_touch();

-- Delete an event (same rule as /ops Event sheets): anyone in catering may delete one the client hasn't approved yet
-- (Inquiry, Draft, For client approval); approved or later events only the owner/admin. Never once real things hang
-- on it — stock moved, orders placed, payments, cash advances or expenses — so the books stay whole.
-- Draft and rejected/cancelled purchase requests for it are removed with it; a website inquiry is unlinked and kept.
create or replace function delete_event(p_event uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e events; why text;
begin
  select * into e from events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if not member_of('catering') then raise exception 'Only the catering team can delete events'; end if;
  if e.status not in ('inquiry', 'draft', 'for_client_approval') and not is_admin() then
    raise exception 'This event is already approved by the client. Only the owner can delete it — or set its status to Cancelled.';
  end if;
  why := concat_ws(', ',
    case when exists (select 1 from stock_moves where event_id = p_event) then 'stock was set aside, issued or returned' end,
    case when exists (select 1 from purchase_orders where event_id = p_event) then 'orders were placed' end,
    case when exists (select 1 from purchase_requests where event_id = p_event and status not in ('draft', 'rejected', 'cancelled')) then 'a purchase request was submitted' end,
    case when exists (select 1 from event_payments where event_id = p_event) then 'payments were recorded' end,
    case when exists (select 1 from cash_advances where event_id = p_event) then 'a cash advance was made' end,
    case when exists (select 1 from expenses where event_id = p_event) then 'expenses were recorded' end);
  if why <> '' then raise exception 'This event can''t be deleted because %. Set its status to Cancelled instead.', why; end if;
  delete from purchase_requests where event_id = p_event;
  update bookings set event_id = null where event_id = p_event;
  delete from events where id = p_event;
  return e.ref;
end $$;
grant execute on function delete_event(uuid) to authenticated;
commit;
