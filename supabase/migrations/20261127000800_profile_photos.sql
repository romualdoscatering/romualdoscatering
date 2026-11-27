-- Profile photos. Each person sets their own on My account; the owner can remove any photo.
-- Photos are shrunk on the phone to a small square (about 15 KB) and kept in the database. Safe to run more than once.
create table if not exists avatars (
  user_id    uuid primary key references profiles(id) on delete cascade,
  img        text not null check (img like 'data:image/jpeg;base64,%' and length(img) < 200000),
  updated_at timestamptz not null default now()
);
alter table avatars enable row level security;   -- no direct access; only the functions below
revoke insert, update, delete on avatars from authenticated, anon;

-- Set (or with null, remove) your own photo
create or replace function my_set_avatar(p_img text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active_user() then raise exception 'Not signed in'; end if;
  if p_img is null then delete from avatars where user_id = auth.uid();
  else insert into avatars(user_id, img) values (auth.uid(), p_img)
       on conflict (user_id) do update set img = excluded.img, updated_at = now();
  end if;
  -- Activity log: that the photo changed (not the photo itself)
  insert into audit_log(actor, tbl, row_id, action, new_row)
  values (auth.uid(), 'avatars', auth.uid()::text, case when p_img is null then 'DELETE' else 'INSERT' end, jsonb_build_object('user_id', auth.uid()));
end $$;

-- Owner: remove someone's photo
create or replace function admin_clear_avatar(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Owner only'; end if;
  delete from avatars where user_id = p_user;
  insert into audit_log(actor, tbl, row_id, action, new_row) values (auth.uid(), 'avatars', p_user::text, 'DELETE', jsonb_build_object('user_id', p_user));
end $$;

-- Which photos exist (and when they changed) — the app only downloads the ones it doesn't have yet
create or replace function avatar_list() returns table (user_id uuid, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.user_id, a.updated_at from avatars a join profiles p on p.id = a.user_id where p.active and is_active_user()
$$;
create or replace function avatar_get(p_ids uuid[]) returns table (user_id uuid, img text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.user_id, a.img, a.updated_at from avatars a join profiles p on p.id = a.user_id
  where a.user_id = any(p_ids) and p.active and is_active_user()
$$;

revoke all on function my_set_avatar(text), admin_clear_avatar(uuid), avatar_list(), avatar_get(uuid[]) from public, anon;
grant execute on function my_set_avatar(text), admin_clear_avatar(uuid), avatar_list(), avatar_get(uuid[]) to authenticated;
