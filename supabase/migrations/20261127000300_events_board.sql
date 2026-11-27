-- Romualdo's · Events board: everyone on the team can SEE the events and bookings, read-only
-- Basic details only: client name, occasion, date and time, guests, venue / pick-up or delivery, menu and
-- kitchen notes. No prices, no client phone or email. Editing stays with the catering roles as before.
-- Safe to run more than once.

create or replace function events_board(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_active_user()) then raise exception 'Sign in to see the events board.'; end if;
  if p_to < p_from or p_to - p_from > 120 then raise exception 'Choose up to 120 days.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'ref', e.ref, 'title', e.title, 'client', coalesce(c.name, e.sheet ->> 'client', e.title),
      'event_type', e.event_type, 'kind', e.kind, 'event_date', e.event_date, 'serve_time', e.serve_time,
      'venue', e.venue, 'pax', e.pax, 'status', e.status,
      'fulfil', e.sheet ->> 'fulfil', 'call', e.sheet ->> 'call', 'pull', e.sheet ->> 'pull', 'pkg', e.sheet ->> 'pkg',
      'motif', e.sheet ->> 'motif', 'setup', e.sheet ->> 'setup', 'allergy', e.sheet ->> 'allergy', 'special', e.sheet ->> 'special',
      'menu', coalesce((select jsonb_agg(jsonb_build_object('course', m.course, 'name', coalesce(nullif(m.custom_name, ''), d.name, p.name),
                                                            'qty', m.qty, 'servings', m.servings, 'note', m.note) order by m.sort, m.course)
                        from event_menu m left join dishes d on d.id = m.dish_id left join pack_sets p on p.id = m.pack_id
                        where m.event_id = e.id), '[]'::jsonb)
    ) order by e.event_date, e.serve_time nulls last)
    from events e left join clients c on c.id = e.client_id
    where e.event_date between p_from and p_to and e.status not in ('cancelled', 'closed')
  ), '[]'::jsonb);
end $$;

revoke all on function events_board(date, date) from public, anon;
grant execute on function events_board(date, date) to authenticated;
