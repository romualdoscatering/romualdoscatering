-- Pokes (endorsements): a short note from one team member to another person or a whole team,
-- shown on their home screen and sent to their phone. The owner, managers and head chefs see every poke.
-- Safe to run more than once.

create table if not exists pokes (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references profiles(id) default auth.uid(),
  body         text not null check (length(btrim(body)) between 1 and 500),
  due_at       timestamptz,
  urgent       boolean not null default false,
  to_label     text,                                -- "Rey, Chefs · Restaurant": who it was sent to, as shown
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references profiles(id)
);
create table if not exists poke_to (
  poke_id   uuid not null references pokes(id) on delete cascade,
  user_id   uuid not null references profiles(id),
  seen_at   timestamptz,
  done_at   timestamptz,
  reply     text check (reply is null or length(reply) <= 300),
  primary key (poke_id, user_id)
);
create index if not exists poke_to_user_idx on poke_to (user_id, done_at);
create index if not exists pokes_created_idx on pokes (created_at desc);

-- Phones that asked for notifications (one row per phone/browser)
create table if not exists push_subs (
  endpoint   text primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on push_subs (user_id);

-- Owner, managers and head chefs see all pokes; "watch_pokes" = also get a phone notification for every poke
alter table profiles add column if not exists watch_pokes boolean not null default true;

-- App settings everyone may read (only the phone-notification public key for now)
create table if not exists app_config (key text primary key, value text, updated_at timestamptz not null default now(), updated_by uuid default auth.uid());

create or replace function poke_overseer(u uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = u and p.active and (p.is_admin
           or exists (select 1 from memberships m where m.user_id = u and m.role in ('manager', 'head_chef'))))
$$;

alter table pokes enable row level security;
alter table poke_to enable row level security;
alter table push_subs enable row level security;
alter table app_config enable row level security;
-- pokes / poke_to: no direct reading (policies would loop on each other); the app reads them through my_pokes() below
drop policy if exists "read" on pokes;
drop policy if exists "read" on poke_to;
drop policy if exists "read" on app_config;
create policy "read" on app_config for select using (is_active_user() and key in ('vapid_public'));
-- push_subs: no direct access; only through the functions below
revoke insert, update, delete on pokes, poke_to, push_subs, app_config from authenticated, anon;

-- Who can be poked: every active team member, with their roles (no emails or phones)
create or replace function poke_people() returns table (id uuid, name text, full_name text, roles jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(btrim(p.nickname), ''), split_part(p.full_name, ' ', 1)), p.full_name,
         coalesce((select jsonb_agg(jsonb_build_object('ws', m.ws, 'role', m.role)) from memberships m where m.user_id = p.id), '[]')
  from profiles p where p.active and is_active_user() order by p.full_name
$$;

-- Send a poke to people and/or teams ([{ws, role}]). Returns the poke id.
create or replace function send_poke(p_to uuid[], p_teams jsonb, p_body text, p_due timestamptz, p_urgent boolean, p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
declare k uuid; n int;
begin
  if not is_active_user() then raise exception 'Not signed in'; end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'Write the message first'; end if;
  if length(p_body) > 500 then raise exception 'Keep it to 500 characters'; end if;
  insert into pokes(from_user, body, due_at, urgent, to_label) values (auth.uid(), btrim(p_body), p_due, coalesce(p_urgent, false), left(p_label, 200)) returning id into k;
  insert into poke_to(poke_id, user_id)
  select k, u from (
    select unnest(coalesce(p_to, '{}'::uuid[])) u
    union
    select m.user_id from memberships m join jsonb_array_elements(coalesce(p_teams, '[]'::jsonb)) t
      on m.ws::text = t ->> 'ws' and (t ->> 'role' = '*' or m.role::text = t ->> 'role')
  ) x join profiles p on p.id = x.u and p.active
  where x.u <> auth.uid()
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Pick at least one person (other than you)'; end if;
  return k;
end $$;

create or replace function poke_seen(p_poke uuid) returns void language sql security definer set search_path = public as $$
  update poke_to set seen_at = now() where poke_id = p_poke and user_id = auth.uid() and seen_at is null
$$;
create or replace function poke_done(p_poke uuid, p_reply text) returns void language plpgsql security definer set search_path = public as $$
begin
  update poke_to set done_at = now(), seen_at = coalesce(seen_at, now()), reply = nullif(left(btrim(coalesce(p_reply, '')), 300), '')
   where poke_id = p_poke and user_id = auth.uid();
  if not found then raise exception 'This poke is not for you'; end if;
end $$;
create or replace function poke_undo(p_poke uuid) returns void language sql security definer set search_path = public as $$
  update poke_to set done_at = null, reply = null where poke_id = p_poke and user_id = auth.uid()
$$;
create or replace function poke_cancel(p_poke uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update pokes set cancelled_at = now(), cancelled_by = auth.uid()
   where id = p_poke and cancelled_at is null and (from_user = auth.uid() or is_admin());
  if not found then raise exception 'Only the sender or the owner can take a poke back'; end if;
end $$;

-- Everything the Pokes screens need, in one call
create or replace function my_pokes() returns jsonb
language sql stable security definer set search_path = public as $$
  with nm as (select p.id, coalesce(nullif(btrim(p.nickname), ''), split_part(p.full_name, ' ', 1)) n, p.full_name f from profiles p),
  rec as (select t.poke_id, jsonb_agg(jsonb_build_object('id', t.user_id, 'name', nm.n, 'seen_at', t.seen_at, 'done_at', t.done_at, 'reply', t.reply) order by nm.n) r
            from poke_to t join nm on nm.id = t.user_id group by t.poke_id),
  base as (select k.*, nm.n from_name, nm.f from_full, rec.r recipients from pokes k join nm on nm.id = k.from_user left join rec on rec.poke_id = k.id)
  select jsonb_build_object(
    'inbox', coalesce((select jsonb_agg(to_jsonb(b) - 'recipients' || jsonb_build_object('seen_at', t.seen_at, 'done_at', t.done_at, 'reply', t.reply, 'others', jsonb_array_length(b.recipients) - 1)
                         order by (t.done_at is not null), b.urgent desc, b.created_at desc)
                       from base b join poke_to t on t.poke_id = b.id and t.user_id = auth.uid()
                       where b.cancelled_at is null and (t.done_at is null or t.done_at > now() - interval '2 days')), '[]'),
    'sent', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from base b
                       where b.from_user = auth.uid() and b.created_at > now() - interval '14 days'), '[]'),
    'all', case when poke_overseer() then coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from base b
                       where b.created_at > now() - interval '7 days'), '[]') end,
    'overseer', poke_overseer(),
    'watch', (select watch_pokes from profiles where id = auth.uid()))
$$;

-- Unread count for the bell (cheap; the app asks every 30 seconds)
create or replace function poke_unread() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', (select count(*) from poke_to t join pokes k on k.id = t.poke_id where t.user_id = auth.uid() and t.done_at is null and k.cancelled_at is null),
    'unseen', (select count(*) from poke_to t join pokes k on k.id = t.poke_id where t.user_id = auth.uid() and t.seen_at is null and k.cancelled_at is null),
    'latest', (select jsonb_build_object('id', k.id, 'body', k.body, 'from', coalesce(nullif(btrim(p.nickname), ''), split_part(p.full_name, ' ', 1)), 'urgent', k.urgent)
               from poke_to t join pokes k on k.id = t.poke_id join profiles p on p.id = k.from_user
               where t.user_id = auth.uid() and t.seen_at is null and k.cancelled_at is null order by k.created_at desc limit 1))
$$;

create or replace function set_watch_pokes(p_on boolean) returns void language sql security definer set search_path = public as $$
  update profiles set watch_pokes = coalesce(p_on, true) where id = auth.uid()
$$;

-- Phone notifications: this phone's subscription
create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_active_user() then raise exception 'Not signed in'; end if;
  insert into push_subs(endpoint, user_id, p256dh, auth, ua) values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, created_at = now();
end $$;
create or replace function push_unsubscribe(p_endpoint text) returns void language sql security definer set search_path = public as $$
  delete from push_subs where endpoint = p_endpoint and user_id = auth.uid()
$$;
create or replace function admin_set_config(p_key text, p_value text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Owner only'; end if;
  if p_key not in ('vapid_public') then raise exception 'Unknown setting'; end if;
  insert into app_config(key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end $$;

revoke all on function poke_overseer(uuid), poke_people(), send_poke(uuid[], jsonb, text, timestamptz, boolean, text), poke_seen(uuid), poke_done(uuid, text), poke_undo(uuid),
  poke_cancel(uuid), my_pokes(), poke_unread(), set_watch_pokes(boolean), push_subscribe(text, text, text, text), push_unsubscribe(text), admin_set_config(text, text) from public, anon;
grant execute on function poke_overseer(uuid), poke_people(), send_poke(uuid[], jsonb, text, timestamptz, boolean, text), poke_seen(uuid), poke_done(uuid, text), poke_undo(uuid),
  poke_cancel(uuid), my_pokes(), poke_unread(), set_watch_pokes(boolean), push_subscribe(text, text, text, text), push_unsubscribe(text), admin_set_config(text, text) to authenticated;

-- The "poke-push" Edge Function reads these with the service key to send phone notifications
grant usage on schema public to service_role;
grant select on pokes, poke_to, profiles, memberships to service_role;
grant select, delete on push_subs to service_role;

-- Who sent, seen, done and took back: in the Activity log (phone subscriptions are not logged)
do $$ begin
  if exists (select 1 from pg_proc where proname = 'audit_trigger') then
    execute 'drop trigger if exists audit on pokes';   execute 'create trigger audit after insert or update or delete on pokes for each row execute function audit_trigger()';
    execute 'drop trigger if exists audit on poke_to'; execute 'create trigger audit after insert or update or delete on poke_to for each row execute function audit_trigger()';
    execute 'drop trigger if exists audit on app_config'; execute 'create trigger audit after insert or update or delete on app_config for each row execute function audit_trigger()';
  end if;
end $$;
