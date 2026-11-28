-- People page: when each login was made and last used (owner only), to spot new sign-ins
create or replace function admin_logins() returns table (id uuid, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the owner can see this' using errcode = '42501'; end if;
  return query select u.id, u.created_at, u.last_sign_in_at from auth.users u;
end $$;
grant execute on function admin_logins() to authenticated;
