-- Local stand-in for what Supabase provides (NOT deployed): roles, auth schema, auth.uid()
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- like the project setting "Grant API access to new tables automatically" = OFF: no default grants
-- newer migrations grant to Supabase's server role and read sign-in times
do $$ begin
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
alter table auth.users add column if not exists last_sign_in_at timestamptz;
alter table auth.users add column if not exists created_at timestamptz default now();
