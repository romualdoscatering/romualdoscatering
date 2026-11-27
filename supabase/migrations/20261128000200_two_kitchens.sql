-- Two (or more) kitchens: each event says which kitchen the food leaves from. Safe to run more than once.
-- The kitchens are kept in app settings as a list: [{"id","name","lat","lng","place"}]. An event with no kitchen chosen uses the first one.
alter table events add column if not exists kitchen text;

drop policy if exists "read" on app_config;
create policy "read" on app_config for select using (is_active_user() and key in ('vapid_public', 'gmaps_key', 'origin', 'kitchens', 'setup_mins', 'load_mins'));
create or replace function admin_set_config(p_key text, p_value text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Owner only'; end if;
  if p_key not in ('vapid_public', 'gmaps_key', 'origin', 'kitchens', 'setup_mins', 'load_mins') then raise exception 'Unknown setting'; end if;
  insert into app_config(key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end $$;

-- Choose the kitchen for an event (the people who can edit the event); the old drive no longer applies
create or replace function event_set_kitchen(p_event uuid, p_kitchen text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or has_role('catering', array['event_specialist', 'coordinator', 'manager', 'finance']::app_role[])) then
    raise exception 'Only the event team can choose the kitchen'; end if;
  update events set kitchen = nullif(btrim(p_kitchen), '') where id = p_event and status <> 'closed';
  if not found then raise exception 'Event not found or closed'; end if;
  delete from event_travel where event_id = p_event;
end $$;
revoke all on function event_set_kitchen(uuid, text) from public, anon;
grant execute on function event_set_kitchen(uuid, text) to authenticated;

-- Events board: also which kitchen
create or replace function events_board(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_active_user()) then raise exception 'Sign in to see the events board.'; end if;
  if p_to < p_from or p_to - p_from > 120 then raise exception 'Choose up to 120 days.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'ref', e.ref, 'title', e.title, 'client', coalesce(c.name, e.sheet ->> 'client', e.title),
      'event_type', e.event_type, 'kind', e.kind, 'event_date', e.event_date, 'serve_time', e.serve_time,
      'venue', e.venue, 'pax', e.pax, 'status', e.status, 'venue_lat', e.venue_lat, 'venue_lng', e.venue_lng, 'kitchen', e.kitchen,
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
