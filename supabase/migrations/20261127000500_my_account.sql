-- My account page: each person sees their own details, can set their own nickname and phone,
-- and sees the last things they did in the app. Safe to run more than once.

-- Your own details (login name, phone, since when, last sign-in)
create or replace function my_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'full_name', p.full_name, 'nickname', p.nickname, 'phone', p.phone,
    'is_admin', p.is_admin, 'since', p.created_at, 'last_sign_in', u.last_sign_in_at)
  from profiles p left join auth.users u on u.id = p.id
  where p.id = auth.uid()
$$;

-- Change your own nickname and phone (name, login and roles stay with the owner)
create or replace function my_update_profile(p_nickname text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if length(btrim(coalesce(p_nickname, ''))) > 30 then raise exception 'Nickname: 30 characters at most'; end if;
  if length(btrim(coalesce(p_phone, ''))) > 30 then raise exception 'Phone: 30 characters at most'; end if;
  update profiles set nickname = nullif(btrim(p_nickname), ''), phone = nullif(btrim(p_phone), '') where id = auth.uid();
end $$;

-- The last things you did (only your own entries, and only the fields needed to say what it was)
create or replace function my_activity(p_limit int default 15) returns table (at timestamptz, tbl text, action text, old_row jsonb, new_row jsonb)
language sql stable security definer set search_path = public as $$
  with keep(k) as (values ('ref'), ('pr_no'), ('po_no'), ('bill_no'), ('order_no'), ('title'), ('name'), ('full_name'), ('username'), ('ws'), ('role'),
                          ('status'), ('voided_at'), ('approved_by'), ('revoked_at'), ('closed_at'), ('posted_at'), ('verified_at'), ('sent_at'),
                          ('dish_id'), ('item_id'), ('event_id'))
  select a.at, a.tbl, a.action,
         (select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(a.old_row, '{}')) e where e.key in (select k from keep)),
         (select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(a.new_row, '{}')) e where e.key in (select k from keep))
  from audit_log a
  where a.actor = auth.uid() and a.actor is not null
  order by a.at desc
  limit least(greatest(coalesce(p_limit, 15), 1), 50)
$$;

revoke all on function my_account(), my_update_profile(text, text), my_activity(int) from public, anon;
grant execute on function my_account(), my_update_profile(text, text), my_activity(int) to authenticated;
