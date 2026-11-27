-- My teammates: who's on the team and who's in the app right now. Safe to run more than once.
-- The app says "I'm here" every 30 seconds while it's open on screen. Kept in its own small table
-- (not in profiles) so it doesn't fill the Activity log.
create table if not exists presence (
  user_id   uuid primary key references profiles(id) on delete cascade,
  last_seen timestamptz not null default now()
);
alter table presence enable row level security;   -- no direct access; only the functions below
revoke insert, update, delete on presence from authenticated, anon;

create or replace function i_am_here() returns void language sql security definer set search_path = public as $$
  insert into presence(user_id, last_seen) select auth.uid(), now() where is_active_user()
  on conflict (user_id) do update set last_seen = now()
$$;

-- Everyone active on the team: name, nickname, roles, when they were last in the app (no emails or phones)
create or replace function team_list() returns table (id uuid, name text, full_name text, roles jsonb, is_admin boolean, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(btrim(p.nickname), ''), split_part(p.full_name, ' ', 1)), p.full_name,
         coalesce((select jsonb_agg(jsonb_build_object('ws', m.ws, 'role', m.role)) from memberships m where m.user_id = p.id), '[]'),
         p.is_admin, (select r.last_seen from presence r where r.user_id = p.id)
  from profiles p where p.active and is_active_user()
  order by (select r.last_seen from presence r where r.user_id = p.id) desc nulls last, p.full_name
$$;

revoke all on function i_am_here(), team_list() from public, anon;
grant execute on function i_am_here(), team_list() to authenticated;
