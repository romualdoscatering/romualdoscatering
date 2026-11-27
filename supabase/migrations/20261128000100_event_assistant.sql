-- Event assistant: pin the venue / delivery address, work out the drive from the kitchen with Google Maps,
-- and give the team a send-off time (serve time − set-up buffer − drive − loading). Safe to run more than once.

-- Where the food goes (pinned on a map)
alter table events add column if not exists venue_lat double precision;
alter table events add column if not exists venue_lng double precision;
alter table events add column if not exists venue_place text;

-- The latest drive estimate per event (kept apart from the event so a recalculation doesn't count as "someone edited the event")
create table if not exists event_travel (
  event_id    uuid primary key references events(id) on delete cascade,
  mins        int not null check (mins between 0 and 1440),
  km          numeric(7, 1),
  depart_for  timestamptz,          -- the departure time Google was asked about (traffic for that time)
  source      text not null default 'google',
  computed_at timestamptz not null default now()
);
alter table event_travel enable row level security;
drop policy if exists "read" on event_travel;
create policy "read" on event_travel for select using (is_active_user());
revoke insert, update, delete on event_travel from authenticated, anon;

-- Settings the whole team reads: Google Maps browser key (public by design, locked to romualdos.ph in Google Cloud),
-- the kitchen's location, the set-up buffer and the loading time
drop policy if exists "read" on app_config;
create policy "read" on app_config for select using (is_active_user() and key in ('vapid_public', 'gmaps_key', 'origin', 'setup_mins', 'load_mins'));
create or replace function admin_set_config(p_key text, p_value text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Owner only'; end if;
  if p_key not in ('vapid_public', 'gmaps_key', 'origin', 'setup_mins', 'load_mins') then raise exception 'Unknown setting'; end if;
  insert into app_config(key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end $$;

-- Pin (or clear) an event's location: the people who can edit the event
create or replace function event_set_pin(p_event uuid, p_lat double precision, p_lng double precision, p_place text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or has_role('catering', array['event_specialist', 'coordinator', 'manager', 'finance']::app_role[])) then
    raise exception 'Only the event team can pin the location'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then raise exception 'That location looks wrong'; end if;
  update events set venue_lat = p_lat, venue_lng = p_lng, venue_place = left(nullif(btrim(p_place), ''), 300) where id = p_event and status <> 'closed';
  if not found then raise exception 'Event not found or closed'; end if;
  delete from event_travel where event_id = p_event;   -- the old drive no longer applies
end $$;
revoke all on function event_set_pin(uuid, double precision, double precision, text) from public, anon;
grant execute on function event_set_pin(uuid, double precision, double precision, text) to authenticated;

-- Events board: also the pin and the latest drive (for "Leave by" on every card)
create or replace function events_board(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_active_user()) then raise exception 'Sign in to see the events board.'; end if;
  if p_to < p_from or p_to - p_from > 120 then raise exception 'Choose up to 120 days.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'ref', e.ref, 'title', e.title, 'client', coalesce(c.name, e.sheet ->> 'client', e.title),
      'event_type', e.event_type, 'kind', e.kind, 'event_date', e.event_date, 'serve_time', e.serve_time,
      'venue', e.venue, 'pax', e.pax, 'status', e.status, 'venue_lat', e.venue_lat, 'venue_lng', e.venue_lng,
      'travel_mins', t.mins, 'travel_km', t.km, 'travel_source', t.source,
      'fulfil', e.sheet ->> 'fulfil', 'call', e.sheet ->> 'call', 'pull', e.sheet ->> 'pull', 'pkg', e.sheet ->> 'pkg',
      'motif', e.sheet ->> 'motif', 'setup', e.sheet ->> 'setup', 'allergy', e.sheet ->> 'allergy', 'special', e.sheet ->> 'special',
      'menu', coalesce((select jsonb_agg(jsonb_build_object('course', m.course, 'name', coalesce(nullif(m.custom_name, ''), d.name, p.name),
                                                            'qty', m.qty, 'servings', m.servings, 'note', m.note) order by m.sort, m.course)
                        from event_menu m left join dishes d on d.id = m.dish_id left join pack_sets p on p.id = m.pack_id
                        where m.event_id = e.id), '[]'::jsonb)
    ) order by e.event_date, e.serve_time nulls last)
    from events e left join clients c on c.id = e.client_id left join event_travel t on t.event_id = e.id
    where e.event_date between p_from and p_to and e.status not in ('cancelled', 'closed')
  ), '[]'::jsonb);
end $$;
revoke all on function events_board(date, date) from public, anon;
grant execute on function events_board(date, date) to authenticated;

grant select on app_config, event_travel to authenticated;   -- reading is still limited by the policies above

-- The Edge Function (poke-push, event "route") reads the event and settings and saves the drive with the service key
grant select on events, app_config to service_role;
grant select, insert, update on event_travel to service_role;

-- Keep drive recalculations out of the Activity log (pins are logged, as event changes)
drop trigger if exists audit on event_travel;
