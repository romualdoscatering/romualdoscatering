-- Restaurant: the menu dishes counted every day (Kitchen stocks), their par/low levels, and the daily counts.
-- Replaces /ops "Kitchen stocks". The person counting is the logged-in user (no typing names).

create table if not exists restaurant_menu (
  dish_id    uuid primary key references dishes(id) on delete cascade,
  section    text not null default 'Others',          -- menu section as printed (Magandang Umaga!, Kakatakam …)
  protein    text not null default 'Others',          -- Chicken, Pork, Beef, Fish & Seafood, Veggies and Produce, Rice, Noodles & Pasta, Others
  par        numeric(8,2) not null default 10 check (par >= 0),         -- cook back up to this many portions
  min_level  numeric(8,2) not null default 5 check (min_level >= 0),    -- below this = low, goes on the restock list
  sort       int not null default 0,
  active     boolean not null default true
);

alter table dish_day_counts add column if not exists note text;
alter table dish_day_counts add column if not exists updated_at timestamptz not null default now();
alter table dish_day_counts alter column counted_by set default auth.uid();

create table if not exists kitchen_days (
  count_date date primary key,
  saved_by   uuid references profiles(id) default auth.uid(),
  saved_at   timestamptz not null default now(),
  note       text
);

-- One row per menu dish for a day: the saved count if there is one, otherwise beginning = the last saved ending
create or replace function kitchen_sheet(p_date date)
returns table (dish_id uuid, name text, section text, protein text, sort int, par numeric, min_level numeric,
               beginning numeric, produced numeric, pulled_out numeric, sold numeric, ending numeric, note text, saved boolean)
language sql stable security invoker set search_path = public as $$
  select m.dish_id, d.name, m.section, m.protein, m.sort, m.par, m.min_level,
         coalesce(c.beginning, prev.ending, 0), coalesce(c.produced, 0), coalesce(c.pulled_out, 0), coalesce(c.sold, 0),
         coalesce(c.ending, prev.ending, 0), c.note, c.dish_id is not null
  from restaurant_menu m join dishes d on d.id = m.dish_id
  left join dish_day_counts c on c.dish_id = m.dish_id and c.count_date = p_date
  left join lateral (select x.ending from dish_day_counts x where x.dish_id = m.dish_id and x.count_date < p_date
                     order by x.count_date desc limit 1) prev on true
  where m.active
  order by m.sort, d.name
$$;

-- Security
alter table restaurant_menu enable row level security;
alter table kitchen_days enable row level security;
create policy "read" on restaurant_menu for select using (member_of('restaurant'));
create policy "write" on restaurant_menu for all using (has_role('restaurant', array['manager', 'chef']::app_role[])) with check (has_role('restaurant', array['manager', 'chef']::app_role[]));
create policy "read" on kitchen_days for select using (member_of('restaurant'));
create policy "write" on kitchen_days for all using (member_of('restaurant')) with check (member_of('restaurant'));
grant select, insert, update, delete on restaurant_menu, kitchen_days to authenticated;
grant execute on function kitchen_sheet(date) to authenticated;
revoke execute on function kitchen_sheet(date) from anon;
do $$ declare t text; begin
  foreach t in array array['restaurant_menu', 'dish_day_counts', 'kitchen_days', 'item_par'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = t::regclass) then
      execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_trigger()', t);
    end if;
  end loop;
end $$;
