-- Duplicate events: find them, merge one into the other, or delete an event outright.
-- Only the owner (admin) and catering managers can delete or merge.
-- Every delete and merge keeps a full copy of the removed event (with its menu) in the activity log.

create or replace function event_admin() returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or has_role('catering', array['manager']::app_role[])
$$;
grant execute on function event_admin() to authenticated;

-- What is attached to an event (used to explain what a delete would lose)
create or replace function event_links(p_event uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'menu',      (select count(*) from event_menu where event_id = p_event),
    'payments',  (select count(*) from event_payments where event_id = p_event),
    'paid',      (select coalesce(sum(amount), 0) from event_payments where event_id = p_event),
    'bill',      (select count(*) from event_bills where event_id = p_event),
    'requests',  (select count(*) from purchase_requests where event_id = p_event),
    'orders',    (select count(*) from purchase_orders where event_id = p_event),
    'expenses',  (select count(*) from expenses where event_id = p_event),
    'advances',  (select count(*) from cash_advances where event_id = p_event),
    'stock',     (select count(*) from stock_moves where event_id = p_event),
    'equipment', (select count(*) from event_equipment where event_id = p_event),
    'inquiry',   (select count(*) from bookings where event_id = p_event))
$$;

-- Events that look like the same booking: same date and same client (by client record or by name)
create or replace function event_duplicates() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not event_admin() then raise exception 'Only the owner or a catering manager can do this' using errcode = '42501'; end if;
  with ev as (
    select e.*, coalesce(c.name, e.title) as who, c.phone,
           regexp_replace(lower(coalesce(c.name, e.title, '')), '[^a-z0-9]', '', 'g') as norm
    from events e left join clients c on c.id = e.client_id
    where e.event_date >= current_date - 60
  ), grp as (
    select event_date, norm from ev where norm <> '' group by event_date, norm having count(*) > 1
  )
  select coalesce(jsonb_agg(g order by g.date, g.who), '[]') into out from (
    select grp.event_date as date, min(ev.who) as who,
      jsonb_agg(jsonb_build_object('id', ev.id, 'ref', ev.ref, 'title', ev.title, 'who', ev.who, 'phone', ev.phone, 'kind', ev.kind,
        'status', ev.status, 'serve_time', ev.serve_time, 'pax', ev.pax, 'venue', ev.venue, 'ops_id', ev.ops_id,
        'created_at', ev.created_at, 'links', event_links(ev.id)) order by ev.created_at) as events
    from grp join ev on ev.event_date = grp.event_date and ev.norm = grp.norm
    group by grp.event_date, grp.norm) g;
  return out;
end $$;
grant execute on function event_duplicates() to authenticated;

-- Keep a full copy before removing
create or replace function event_snapshot(p_event uuid, p_action text, p_note text) returns void language sql security definer set search_path = public as $$
  insert into audit_log(actor, tbl, row_id, action, old_row, new_row)
  select auth.uid(), 'events', e.id::text, p_action,
         to_jsonb(e) || jsonb_build_object('menu', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from event_menu m where m.event_id = e.id),
                                           'equipment', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from event_equipment x where x.event_id = e.id)),
         jsonb_build_object('note', p_note)
  from events e where e.id = p_event
$$;

-- Delete an event that has nothing important attached (no money, purchases or stock)
create or replace function event_delete(p_event uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare l jsonb; e events; blockers text := '';
begin
  if not event_admin() then raise exception 'Only the owner or a catering manager can delete events' using errcode = '42501'; end if;
  select * into e from events where id = p_event for update;
  if e.id is null then raise exception 'Event not found'; end if;
  l := event_links(p_event);
  if (l->>'payments')::int > 0 then blockers := blockers || ', payments recorded'; end if;
  if (l->>'requests')::int + (l->>'orders')::int > 0 then blockers := blockers || ', purchase requests or orders'; end if;
  if (l->>'expenses')::int + (l->>'advances')::int > 0 then blockers := blockers || ', expenses or cash advances'; end if;
  if (l->>'stock')::int > 0 then blockers := blockers || ', stock issued'; end if;
  if blockers <> '' then
    raise exception 'This event has %. Merge it into the other copy instead, or mark it Cancelled.', substr(blockers, 3);
  end if;
  perform event_snapshot(p_event, 'DELETE_EVENT', p_reason);
  update bookings set event_id = null where event_id = p_event;
  delete from events where id = p_event;
  return jsonb_build_object('deleted', e.ref);
end $$;
grant execute on function event_delete(uuid, text) to authenticated;

-- Merge a duplicate into the one to keep: everything attached moves over, then the duplicate is removed.
-- Money, purchases, expenses, advances and stock always move. Menu, equipment, extra needs and reservations
-- move only when the kept event has none of its own. One-per-event records (billing, costing, travel, run) move when the kept one has none.
create or replace function event_merge(p_drop uuid, p_keep uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare d events; k events;
begin
  if not event_admin() then raise exception 'Only the owner or a catering manager can merge events' using errcode = '42501'; end if;
  if p_drop = p_keep then raise exception 'Pick two different events'; end if;
  select * into d from events where id = p_drop for update;
  select * into k from events where id = p_keep for update;
  if d.id is null or k.id is null then raise exception 'Event not found'; end if;
  perform event_snapshot(p_drop, 'MERGE_EVENT', 'merged into ' || k.ref);

  update event_payments   set event_id = p_keep where event_id = p_drop;
  update purchase_requests set event_id = p_keep where event_id = p_drop;
  update purchase_orders  set event_id = p_keep where event_id = p_drop;
  update expenses         set event_id = p_keep where event_id = p_drop;
  update cash_advances    set event_id = p_keep where event_id = p_drop;
  update stock_moves      set event_id = p_keep where event_id = p_drop;
  update bookings         set event_id = p_keep where event_id = p_drop;

  if not exists (select 1 from event_menu where event_id = p_keep) then update event_menu set event_id = p_keep where event_id = p_drop; end if;
  if not exists (select 1 from event_equipment where event_id = p_keep) then update event_equipment set event_id = p_keep where event_id = p_drop; end if;
  if not exists (select 1 from event_extra_needs where event_id = p_keep) then update event_extra_needs set event_id = p_keep where event_id = p_drop; end if;
  if not exists (select 1 from stock_reservations where event_id = p_keep) then update stock_reservations set event_id = p_keep where event_id = p_drop; end if;
  if not exists (select 1 from event_bills where event_id = p_keep) and exists (select 1 from event_bills where event_id = p_drop) then
    insert into event_bills select * from jsonb_populate_record(null::event_bills, (select to_jsonb(b) || jsonb_build_object('event_id', p_keep) from event_bills b where b.event_id = p_drop));
    update bill_lines set event_id = p_keep where event_id = p_drop;
  end if;
  if not exists (select 1 from event_finance where event_id = p_keep) then update event_finance set event_id = p_keep where event_id = p_drop; end if;
  if not exists (select 1 from event_travel where event_id = p_keep) then update event_travel set event_id = p_keep where event_id = p_drop; end if;
  if not exists (select 1 from event_runs where event_id = p_keep) then update event_runs set event_id = p_keep where event_id = p_drop; end if;

  -- fill gaps on the kept event from the duplicate
  update events set
    client_id = coalesce(k.client_id, d.client_id), serve_time = coalesce(k.serve_time, d.serve_time), venue = coalesce(k.venue, d.venue),
    pax = coalesce(k.pax, d.pax), contract_price = coalesce(k.contract_price, d.contract_price), coordinator = coalesce(k.coordinator, d.coordinator),
    booking_id = coalesce(k.booking_id, d.booking_id), venue_lat = coalesce(k.venue_lat, d.venue_lat), venue_lng = coalesce(k.venue_lng, d.venue_lng),
    venue_place = coalesce(k.venue_place, d.venue_place), kitchen = coalesce(k.kitchen, d.kitchen),
    sheet = coalesce(d.sheet, '{}'::jsonb) || coalesce(k.sheet, '{}'::jsonb)
  where id = p_keep;
  if k.ops_id is null and d.ops_id is not null then
    update events set ops_id = null where id = p_drop;
    update events set ops_id = d.ops_id where id = p_keep;
  end if;

  delete from events where id = p_drop;   -- anything left over on the duplicate (its own menu etc.) goes with it
  return jsonb_build_object('kept', k.ref, 'removed', d.ref);
end $$;
grant execute on function event_merge(uuid, uuid) to authenticated;
