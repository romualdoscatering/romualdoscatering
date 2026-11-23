-- =====================================================================
-- Romualdo's Platform · 06 · Restaurant daily operations + HR hooks
-- =====================================================================

-- Daily sales (Z-reading) — replaces the "Daily sales" page's records
create table daily_sales (
  sale_date   date primary key,
  gross       numeric(12,2) not null default 0,
  discounts   numeric(12,2) not null default 0,
  service_charge numeric(12,2) not null default 0,
  net         numeric(12,2) generated always as (gross - discounts) stored,
  cash        numeric(12,2), card numeric(12,2), ewallet numeric(12,2),
  z_reading   jsonb,                  -- what was read from the Z-reading photo
  verified_by uuid references profiles(id),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- Kitchen stocks: daily cooked-dish counts per restaurant menu dish (replaces "Kitchen stocks")
create table dish_day_counts (
  count_date date not null,
  dish_id    uuid not null references dishes(id),
  beginning  numeric(8,2) not null default 0,
  produced   numeric(8,2) not null default 0,
  sold       numeric(8,2) not null default 0,
  pulled_out numeric(8,2) not null default 0,     -- spoiled / staff meal / taste test
  ending     numeric(8,2) generated always as (beginning + produced - sold - pulled_out) stored,
  par        numeric(8,2),
  counted_by uuid default auth.uid(),
  primary key (count_date, dish_id)
);

-- Restaurant food cost: ingredients issued to the kitchen vs sales
create or replace view restaurant_food_cost with (security_invoker = true) as
select d.sale_date, d.net as sales,
       coalesce((select -sum(m.qty * m.unit_cost) from stock_moves m where m.ws = 'restaurant' and m.kind = 'issue'
                 and (m.moved_at at time zone 'Asia/Manila')::date = d.sale_date), 0)::numeric(12,2) as ingredients_issued,
       case when d.net > 0 then round(coalesce((select -sum(m.qty * m.unit_cost) from stock_moves m where m.ws = 'restaurant' and m.kind = 'issue'
                 and (m.moved_at at time zone 'Asia/Manila')::date = d.sale_date), 0) / d.net * 100, 1) end as food_cost_pct
from daily_sales d;

-- HR hooks (phase 3 — the time clock keeps running on its current app until then)
create table employees (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid unique references profiles(id),       -- if the employee also logs in to the platform
  full_name   text not null,
  position    text,
  ws          workspace,                                   -- home workspace (null = both / admin)
  daily_rate  numeric(10,2),
  sc_points   numeric(6,2) default 1,                      -- service-charge share weight
  hired_on    date,
  active      boolean not null default true
);
create table time_punches (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references employees(id),
  punched_at  timestamptz not null default now(),
  kind        text not null check (kind in ('in', 'out', 'break_out', 'break_in')),
  source      text not null default 'kiosk',
  photo_path  text,
  note        text
);
create index on time_punches (employee_id, punched_at);
