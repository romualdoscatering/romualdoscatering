-- =====================================================================
-- Romualdo's Platform · 03 · Dishes, standard recipes, packed-meal sets
-- The STANDARD DISH LIST: every dish has one official name (+ the other names
-- people type), and a standard recipe per batch (1 large tray = 12 guests,
-- or per guest for rice, drinks and fruit). Recipes drive automatic
-- purchase requests — but only once a chef has VERIFIED them.
-- =====================================================================

create table dishes (
  id           uuid primary key default gen_random_uuid(),
  name         text unique not null,
  category     text not null,                     -- Chicken, Pork, Beef, Seafood, Vegetables, Pasta & noodles, Salads, Soup, Rice, Desserts, Drinks
  course       text not null default 'Main',      -- course on an event sheet: Soup, Salad / appetizer, Main, Pasta / noodles, Vegetables, Rice, Dessert, Drinks, Station
  sold_as      text[] not null default '{buffet}', -- any of: tray, buffet, pack, restaurant
  tray_price   numeric(10,2),
  tray_serves  int not null default 12,
  standard     boolean not null default false,    -- on the standard (most-chosen) list
  times_booked int not null default 0,            -- refreshed from events by refresh_dish_stats()
  active       boolean not null default true,
  notes        text,
  created_at   timestamptz not null default now()
);

create table dish_aliases (
  alias   text primary key,                       -- stored lower-case
  dish_id uuid not null references dishes(id) on delete cascade
);
comment on table dish_aliases is 'Other spellings people type ("Lumpiang Ubod", "Fried Lumpia Ubod") so they resolve to one dish.';

create or replace function find_dish(p text) returns uuid
language sql stable as $$
  select coalesce(
    (select id from dishes where lower(name) = lower(trim(p))),
    (select dish_id from dish_aliases where alias = lower(trim(p))))
$$;

create table recipes (
  dish_id       uuid primary key references dishes(id) on delete cascade,
  batch_serves  numeric(8,2) not null default 12 check (batch_serves > 0),   -- 12 = one large tray; 1 = per guest
  status        text not null default 'draft' check (status in ('draft', 'verified')),
  verified_by   uuid references profiles(id),
  verified_at   timestamptz,
  method        text,
  updated_at    timestamptz not null default now()
);
create table recipe_lines (
  dish_id  uuid references recipes(dish_id) on delete cascade,
  item_id  uuid references items(id),
  qty      numeric(12,4) not null check (qty > 0),     -- in the item's stock unit, per batch
  primary key (dish_id, item_id)
);

-- Changing a verified recipe puts it back to draft until a chef re-verifies it
create or replace function recipe_line_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update recipes set status = 'draft', verified_by = null, verified_at = null, updated_at = now()
  where dish_id = coalesce(new.dish_id, old.dish_id) and status = 'verified' and not has_role_any(array['chef']::app_role[]);
  update recipes set updated_at = now() where dish_id = coalesce(new.dish_id, old.dish_id);
  return coalesce(new, old);
end $$;
create trigger recipe_lines_changed after insert or update or delete on recipe_lines for each row execute function recipe_line_changed();

create or replace function verify_recipe(p_dish uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role_any(array['chef', 'manager']::app_role[]) then raise exception 'Only a chef or manager can verify recipes' using errcode = '42501'; end if;
  if not exists (select 1 from recipe_lines where dish_id = p_dish) then raise exception 'Recipe has no ingredients'; end if;
  update recipes set status = 'verified', verified_by = auth.uid(), verified_at = now() where dish_id = p_dish;
end $$;

-- How much of each course one guest eats at a BUFFET, as a share of a standalone tray portion.
-- Example: with several mains on the table each main is eaten by ~60% of guests → 0.60.
create table course_rules (
  course  text primary key,
  share   numeric(4,2) not null check (share > 0 and share <= 3),
  note    text
);

-- Pre-packaged meal sets (packed lunches, snack boxes): a pack = servings of several dishes
create table pack_sets (
  id       uuid primary key default gen_random_uuid(),
  name     text unique not null,                -- e.g. 'Packed Lunch A — Chicken Teriyaki'
  price    numeric(10,2),
  active   boolean not null default true,
  notes    text
);
create table pack_components (
  pack_id  uuid references pack_sets(id) on delete cascade,
  dish_id  uuid references dishes(id),
  servings numeric(6,2) not null default 1,       -- 1 = one guest-portion of that dish per pack
  primary key (pack_id, dish_id)
);
