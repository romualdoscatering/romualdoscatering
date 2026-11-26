-- Romualdo's · go-live hardening (POS cash drawer, locked sales records, senior/PWD control)
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1) A payment needs an open cash drawer, and is counted in that drawer
-- ---------------------------------------------------------------------------
create or replace function public.pos_orders_shift_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift uuid;
begin
  -- Only when an order becomes paid
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    select id into v_shift
    from pos_shifts
    where closed_at is null
    order by opened_at desc
    limit 1;

    if v_shift is null then
      raise exception 'Open the cash drawer first (start a shift) before taking payment.';
    end if;

    -- The money lands in the drawer that is open now
    new.shift_id := v_shift;
  end if;
  return new;
end;
$$;

drop trigger if exists pos_orders_shift_guard on public.pos_orders;
create trigger pos_orders_shift_guard
  before insert or update on public.pos_orders
  for each row execute function public.pos_orders_shift_guard();


-- ---------------------------------------------------------------------------
-- 2) Sales and kitchen counts can't be deleted by staff
-- ---------------------------------------------------------------------------
-- daily_sales: cashier / manager / finance may add and correct, nobody deletes
drop policy if exists "write"  on public.daily_sales;
drop policy if exists "insert" on public.daily_sales;
drop policy if exists "update" on public.daily_sales;

create policy "insert" on public.daily_sales for insert
  with check (has_role('restaurant', array['cashier','manager','finance']::app_role[]));
create policy "update" on public.daily_sales for update
  using      (has_role('restaurant', array['cashier','manager','finance']::app_role[]))
  with check (has_role('restaurant', array['cashier','manager','finance']::app_role[]));

-- dish_day_counts: restaurant staff may count, only a manager may delete
drop policy if exists "write"  on public.dish_day_counts;
drop policy if exists "insert" on public.dish_day_counts;
drop policy if exists "update" on public.dish_day_counts;
drop policy if exists "delete" on public.dish_day_counts;

create policy "insert" on public.dish_day_counts for insert
  with check (member_of('restaurant'));
create policy "update" on public.dish_day_counts for update
  using (member_of('restaurant')) with check (member_of('restaurant'));
create policy "delete" on public.dish_day_counts for delete
  using (has_role('restaurant', array['manager']::app_role[]));


-- ---------------------------------------------------------------------------
-- 3) Senior/PWD discount only by cashier or manager (not general staff)
--    To make it manager-only, change the array below to array['manager'].
-- ---------------------------------------------------------------------------
create or replace function public.pos_orders_senior_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.seniors, 0) > coalesce(case when tg_op = 'UPDATE' then old.seniors end, 0)
     and not has_role('restaurant', array['cashier','manager']::app_role[])
     and not is_admin() then
    raise exception 'Only a cashier or manager can apply the Senior/PWD discount. Please call them to check the ID.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_orders_senior_guard on public.pos_orders;
create trigger pos_orders_senior_guard
  before insert or update on public.pos_orders
  for each row execute function public.pos_orders_senior_guard();

-- The guard functions run only as triggers
revoke all on function public.pos_orders_shift_guard()  from public, anon, authenticated;
revoke all on function public.pos_orders_senior_guard() from public, anon, authenticated;

commit;
