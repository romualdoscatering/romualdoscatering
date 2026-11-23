-- =====================================================================
-- Romualdo's Platform · 01 · Foundation: people, workspaces, roles, audit
-- One login for everything. Two workspaces: RESTAURANT and CATERING.
-- A person can hold different roles in each workspace.
-- =====================================================================

create extension if not exists pgcrypto;

create type workspace as enum ('restaurant', 'catering');

-- admin     = owner level, everything in both workspaces
-- manager   = runs a workspace: approves requests, edits setup
-- finance   = billing, payments, cash advances, reports
-- purchaser = buys at the market / from suppliers, turns approved requests into orders
-- storekeeper = receives goods, issues stock, counts
-- chef      = recipes, production, verifies standard recipes
-- coordinator = catering events: bookings, event sheets, menus
-- cashier   = restaurant sales, cash drawer
-- staff     = basic access: file requests, record waste, view
create type app_role as enum ('admin', 'manager', 'finance', 'purchaser', 'storekeeper', 'chef', 'coordinator', 'cashier', 'staff');

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null check (username ~ '^[a-z0-9._-]{2,40}$'),
  full_name   text not null,
  phone       text,
  is_admin    boolean not null default false,       -- owner-level, both workspaces
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table profiles is 'One row per person who can log in. Deactivate (active=false) instead of deleting.';

create table memberships (
  user_id    uuid not null references profiles(id) on delete cascade,
  ws         workspace not null,
  role       app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, ws, role)
);
comment on table memberships is 'Which workspace(s) a person works in, and as what. Example: a purchaser for both, a chef only for restaurant.';

-- ---------- role helpers (used by row-level security and workflow functions) ----------
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and active from profiles where id = auth.uid()), false)
$$;

create or replace function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select active from profiles where id = auth.uid()), false)
$$;

create or replace function member_of(w workspace) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or (is_active_user() and exists (select 1 from memberships m where m.user_id = auth.uid() and m.ws = w))
$$;

create or replace function has_role(w workspace, roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or (is_active_user() and exists (select 1 from memberships m where m.user_id = auth.uid() and m.ws = w and m.role = any(roles)))
$$;

create or replace function has_role_any(roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or (is_active_user() and exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = any(roles)))
$$;

create or replace function require_role(w workspace, roles app_role[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role(w, roles) then
    raise exception 'Not allowed: needs % in %', array_to_string(roles, ' / '), w using errcode = '42501';
  end if;
end $$;

-- ---------- audit trail: every change to important tables, with who and when ----------
create table audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  tbl        text not null,
  row_id     text,
  action     text not null,
  old_row    jsonb,
  new_row    jsonb
);

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(actor, tbl, row_id, action, old_row, new_row)
  values (auth.uid(), tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id', ''),
          tg_op,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- shared columns helper: who created a row
create or replace function set_created_by() returns trigger
language plpgsql as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;

-- yearly document numbers: PR-2026-0001, PO-2026-0001, EV-2026-0001 ...
create table doc_counters (prefix text, yr int, n int not null default 0, primary key (prefix, yr));
create or replace function next_doc_no(p text) returns text
language plpgsql security definer set search_path = public as $$
declare y int := extract(year from (now() at time zone 'Asia/Manila'))::int; v int;
begin
  insert into doc_counters(prefix, yr, n) values (p, y, 1)
  on conflict (prefix, yr) do update set n = doc_counters.n + 1
  returning n into v;
  return p || '-' || y || '-' || lpad(v::text, 4, '0');
end $$;
