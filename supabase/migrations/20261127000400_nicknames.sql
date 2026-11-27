-- Romualdo's · nicknames: the name the owner wants the app to greet each person by
-- Set on the People page (owner only); shown on the home screen and in "Hi, …". Safe to run more than once.

alter table profiles add column if not exists nickname text;
do $$ begin
  alter table profiles add constraint profiles_nickname_len check (nickname is null or length(nickname) between 1 and 30);
exception when duplicate_object then null; end $$;

-- What the app loads at sign-in now includes the nickname
create or replace function my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'full_name', p.full_name, 'nickname', p.nickname, 'is_admin', p.is_admin, 'active', p.active,
    'roles', coalesce((select jsonb_agg(jsonb_build_object('ws', m.ws, 'role', m.role)) from memberships m where m.user_id = p.id), '[]'))
  from profiles p where p.id = auth.uid()
$$;

-- The People list now includes the nickname (the list's columns change, so it is recreated)
drop function if exists admin_people();
create function admin_people() returns table (id uuid, email text, username text, full_name text, nickname text, is_admin boolean, active boolean, roles jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the owner can see this' using errcode = '42501'; end if;
  return query
  select u.id, u.email::text, p.username, p.full_name, p.nickname, coalesce(p.is_admin, false), coalesce(p.active, false),
         coalesce((select jsonb_agg(jsonb_build_object('ws', m.ws, 'role', m.role) order by m.ws, m.role) from memberships m where m.user_id = u.id), '[]')
  from auth.users u left join profiles p on p.id = u.id
  order by p.full_name nulls first, u.email;
end $$;

-- Owner sets someone's nickname (blank clears it)
create or replace function admin_set_nickname(p_user uuid, p_nickname text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the owner can set nicknames.'; end if;
  update profiles set nickname = nullif(trim(p_nickname), '') where id = p_user;
end $$;

revoke all on function admin_people(), admin_set_nickname(uuid, text) from public, anon;
grant execute on function admin_people(), admin_set_nickname(uuid, text) to authenticated;
