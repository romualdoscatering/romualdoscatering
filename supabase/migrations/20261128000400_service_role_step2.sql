-- Service / waiter role, step 2 of 2 (run after step 1). Safe to run more than once.
--
-- Waiters and in-house service staff see, read-only:
--   * the Events board (already open to everyone signed in)
--   * Reservations: restaurant table bookings, plus catering bookings from the website that aren't events yet
--   * the 86 / running-low list
-- and nothing else. A person whose ONLY role is "service" is not treated as a member of the Restaurant or
-- Catering workspace, so they can't read sales, POS orders, purchasing, stock, costing, recipes, suppliers or
-- client contact details, even by calling the database directly. They get their three views through the
-- read-only functions below, which hand back only what a waiter needs (no prices, no client phone or email).
-- Someone with "service" plus another role keeps everything that other role gives them.
begin;

-- ---------- who is a waiter only ----------
create or replace function is_service_only() returns boolean
language sql stable security definer set search_path = public as $$
  select not is_admin() and is_active_user()
     and exists (select 1 from memberships m where m.user_id = auth.uid())
     and not exists (select 1 from memberships m where m.user_id = auth.uid() and m.role <> 'service')
$$;

-- "Member of a workspace" no longer counts the service role: that is what keeps waiters out of the workspace data
create or replace function member_of(w workspace) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or (is_active_user() and exists (select 1 from memberships m where m.user_id = auth.uid() and m.ws = w and m.role <> 'service'))
$$;

-- Shared master data (ingredients and their prices, suppliers, recipes, dishes, packs) stays readable by the
-- rest of the team, but not by waiters
do $$ declare p record; begin
  for p in select tablename, policyname, qual from pg_policies
           where schemaname = 'public' and cmd = 'SELECT' and qual = 'is_active_user()'
             and tablename in ('items', 'suppliers', 'dishes', 'dish_aliases', 'recipes', 'recipe_lines', 'course_rules',
                               'pack_sets', 'pack_components', 'event_travel')
  loop
    execute format('drop policy %I on %I', p.policyname, p.tablename);
    execute format('create policy %I on %I for select using (is_active_user() and not is_service_only())', p.policyname, p.tablename);
  end loop;
end $$;

-- ---------- restaurant table reservations ----------
create table if not exists table_reservations (
  id          uuid primary key default gen_random_uuid(),
  res_date    date not null,
  res_time    time,
  guest_name  text not null check (btrim(guest_name) <> ''),
  phone       text,
  pax         int check (pax > 0),
  table_label text,                                   -- e.g. "T4", "Function room"
  occasion    text,                                   -- birthday, anniversary …
  notes       text,                                   -- allergies, seating requests, cake to set up …
  status      text not null default 'booked' check (status in ('booked', 'seated', 'done', 'no_show', 'cancelled')),
  created_by  uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now()
);
create index if not exists table_reservations_date_idx on table_reservations (res_date, res_time);

create or replace function table_reservations_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;
drop trigger if exists touch on table_reservations;
create trigger touch before insert or update on table_reservations for each row execute function table_reservations_touch();
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'table_reservations'::regclass) then
    create trigger audit after insert or update or delete on table_reservations for each row execute function audit_trigger();
  end if;
end $$;

alter table table_reservations enable row level security;
drop policy if exists "read" on table_reservations;
create policy "read" on table_reservations for select using (member_of('restaurant'));
-- Restaurant managers (and the owner) take and change reservations; nobody deletes, they cancel
drop policy if exists "add" on table_reservations;
create policy "add" on table_reservations for insert with check (has_role('restaurant', array['manager']::app_role[]));
drop policy if exists "edit" on table_reservations;
create policy "edit" on table_reservations for update using (has_role('restaurant', array['manager']::app_role[]))
  with check (has_role('restaurant', array['manager']::app_role[]));
grant select, insert, update on table_reservations to authenticated;
revoke all on table_reservations from anon;

-- ---------- Reservations board: tables + catering bookings, read-only for everyone signed in ----------
-- Guest phone numbers only for Restaurant members; catering bookings never carry phone, email or price.
create or replace function reservations_board(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare show_phone boolean := member_of('restaurant');
begin
  if not (is_admin() or is_active_user()) then raise exception 'Sign in to see reservations.'; end if;
  if p_to < p_from or p_to - p_from > 120 then raise exception 'Choose up to 120 days.'; end if;
  return jsonb_build_object(
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'res_date', r.res_date, 'res_time', r.res_time, 'guest_name', r.guest_name, 'pax', r.pax,
        'table_label', r.table_label, 'occasion', r.occasion, 'notes', r.notes, 'status', r.status,
        'phone', case when show_phone then r.phone end,
        'taken_by', (select coalesce(nullif(btrim(p.nickname), ''), p.full_name) from profiles p where p.id = r.created_by)
      ) order by r.res_date, r.res_time nulls last, r.guest_name)
      from table_reservations r
      where r.res_date between p_from and p_to and r.status <> 'cancelled'), '[]'::jsonb),
    'catering', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'ref', b.ref, 'event_date', b.event_date, 'time', nullif(b.payload #>> '{event,time}', ''),
        'client', coalesce(nullif(b.payload #>> '{corp,company}', ''), b.client_name, 'Website client'),
        'event_type', b.event_type, 'kind', b.kind, 'pax', b.pax, 'status', b.status
      ) order by b.event_date, b.received_at)
      from bookings b
      where b.event_id is null and b.status in ('new', 'contacted', 'quoted')
        and b.event_date between p_from and p_to), '[]'::jsonb)
  );
end $$;
revoke all on function reservations_board(date, date) from public, anon;
grant execute on function reservations_board(date, date) to authenticated;

-- ---------- 86 / running-low list for waiters ----------
-- Same numbers the Restaurant team sees (the stockist's count, plus today's POS sales), names and counts only.
create or replace function board_86(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare last kitchen_days;
begin
  if not (member_of('restaurant') or has_role_any(array['service']::app_role[])) then
    raise exception 'Only the restaurant team sees the 86 list.' using errcode = '42501';
  end if;
  select * into last from kitchen_days order by count_date desc limit 1;
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('name', k.name, 'section', k.section, 'min_level', k.min_level, 'ending', k.ending)
                                       order by k.sort, k.name)
                      from kitchen_sheet(p_date) k), '[]'::jsonb),
    'last', case when last.count_date is null then null else jsonb_build_object(
      'count_date', last.count_date, 'saved_at', last.saved_at,
      'who', coalesce((select full_name from profiles where id = last.saved_by), regexp_replace(coalesce(last.note, ''), '^Counted by |\s\(copied from /ops\)$', '', 'g'))) end
  );
end $$;
revoke all on function board_86(date) from public, anon;
grant execute on function board_86(date) to authenticated;

revoke all on function is_service_only() from public, anon;
grant execute on function is_service_only() to authenticated;

commit;
