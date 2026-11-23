-- =====================================================================
-- Romualdo's Platform · 04 · Catering: clients, website bookings, events, menus
-- Three kinds of catering order, one flow:
--   trays   (pre-packaged) — fixed dishes × number of large trays
--   packs   (pre-packaged) — packed-meal sets × number of packs
--   buffet  (customized)   — guests × chosen dishes per course (+ off-menu dishes)
-- =====================================================================

create table clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default 'individual' check (kind in ('individual', 'corporate', 'institution', 'government')),
  contact    text,
  phone      text,
  email      text,
  notes      text,
  created_at timestamptz not null default now()
);

-- Website inquiries land here (the public site calls submit_booking, below)
create table bookings (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique,
  source      text not null default 'website',
  received_at timestamptz not null default now(),
  status      text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'won', 'lost', 'spam')),
  client_name text, phone text, email text,
  event_date  date, pax int, event_type text,
  payload     jsonb not null,                    -- everything the form sent (menu picks, notes, estimate)
  event_id    uuid,
  handled_by  uuid references profiles(id)
);

create type event_kind as enum ('buffet', 'trays', 'packs');
create type event_status as enum ('inquiry', 'draft', 'for_client_approval', 'confirmed', 'in_prep', 'done', 'closed', 'cancelled');

create table events (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique not null default next_doc_no('EV'),
  kind          event_kind not null default 'buffet',
  client_id     uuid references clients(id),
  title         text not null,                   -- e.g. 'Santos wedding'
  event_type    text,                            -- Birthday, Wedding, Corporate Event… (same A–Z list as the website)
  event_date    date not null,
  serve_time    time,
  venue         text,
  pax           int check (pax is null or pax >= 0),
  status        event_status not null default 'draft',
  contract_price numeric(12,2),
  coordinator   uuid references profiles(id),
  booking_id    uuid references bookings(id),
  sheet         jsonb not null default '{}',     -- the client-facing event sheet details (motif, set-up, equipment, allergies…)
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
alter table bookings add constraint bookings_event_fk foreign key (event_id) references events(id);
alter table stock_moves add constraint stock_moves_event_fk foreign key (event_id) references events(id);

create table event_menu (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  course      text not null default 'Main',
  dish_id     uuid references dishes(id),        -- a standard dish …
  pack_id     uuid references pack_sets(id),     -- … or a packed-meal set …
  custom_name text,                              -- … or an off-menu dish (needs the chef to list ingredients)
  qty         numeric(10,2),                     -- trays or packs (pre-packaged orders)
  servings    numeric(10,2),                     -- optional manual override of guest-portions
  note        text,
  sort        int not null default 0,
  check (num_nonnulls(dish_id, pack_id, custom_name) >= 1)
);
create index on event_menu (event_id);

-- Extra ingredient lines for off-menu dishes or special requests (chef fills these in)
create table event_extra_needs (
  event_id uuid references events(id) on delete cascade,
  item_id  uuid references items(id),
  qty      numeric(12,3) not null check (qty > 0),
  note     text,
  primary key (event_id, item_id)
);

-- Stock already in the catering store that is set aside for an event (so two events don't count the same kilos)
create table stock_reservations (
  event_id uuid references events(id) on delete cascade,
  item_id  uuid references items(id),
  qty      numeric(12,3) not null check (qty >= 0),
  primary key (event_id, item_id)
);

-- ---------- how many guest-portions each menu line needs ----------
create or replace function menu_line_servings(m event_menu, e events) returns numeric
language sql stable as $$
  select case
    when m.servings is not null then m.servings
    when m.qty is not null and m.dish_id is not null then m.qty * coalesce((select tray_serves from dishes where id = m.dish_id), 12)
    when m.qty is not null and m.pack_id is not null then m.qty
    else coalesce(e.pax, 0) * coalesce((select share from course_rules where course = m.course), 1)
  end
$$;

-- ---------- what an event needs, item by item ----------
-- Returns one row per ingredient, plus warnings for dishes that can't be calculated yet.
create or replace function event_requirements(p_event uuid)
returns table (item_id uuid, item text, unit text, needed numeric, reserved_here numeric, free_stock numeric, to_buy numeric, est_cost numeric, from_dishes text)
language plpgsql stable security definer set search_path = public as $$
declare e events;
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Event not found'; end if;
  if not member_of('catering') then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
  with portions as (       -- dish → guest-portions (packs expand into their component dishes)
    select m.dish_id, menu_line_servings(m, e) as serv from event_menu m where m.event_id = p_event and m.dish_id is not null
    union all
    select pc.dish_id, menu_line_servings(m, e) * pc.servings from event_menu m join pack_components pc on pc.pack_id = m.pack_id where m.event_id = p_event
  ), need as (
    select rl.item_id, sum(p.serv / r.batch_serves * rl.qty) as q, string_agg(distinct d.name, ', ') as dishes
    from portions p join recipes r on r.dish_id = p.dish_id and r.status = 'verified'
    join recipe_lines rl on rl.dish_id = r.dish_id join dishes d on d.id = p.dish_id
    group by rl.item_id
    union all
    select x.item_id, x.qty, 'extra / off-menu' from event_extra_needs x where x.event_id = p_event
  ), tot as (
    select n.item_id, sum(n.q) as q, string_agg(n.dishes, ', ') as dishes from need n group by n.item_id
  )
  , calc as (
    select i.id, i.name, i.stock_unit, i.category, i.last_cost,
           round(t.q * (1 + i.waste_pct / 100), 3) as needed,
           coalesce(sr.qty, 0) as reserved_here,
           greatest(on_hand('catering', i.id) - coalesce((select sum(o.qty) from stock_reservations o join events oe on oe.id = o.event_id
                     where o.item_id = i.id and o.event_id <> p_event and oe.status not in ('closed', 'cancelled')), 0), 0) as free_stock,
           t.dishes
    from tot t join items i on i.id = t.item_id
    left join stock_reservations sr on sr.event_id = p_event and sr.item_id = i.id
  )
  select c.id, c.name, c.stock_unit, c.needed, c.reserved_here, c.free_stock,
         greatest(c.needed - c.free_stock, 0),
         round(greatest(c.needed - c.free_stock, 0) * c.last_cost, 2),
         c.dishes
  from calc c
  order by c.category, c.name;
end $$;

create or replace function event_warnings(p_event uuid) returns table (menu_line uuid, dish text, problem text)
language sql stable security definer set search_path = public as $$
  select m.id, coalesce(d.name, ps.name, m.custom_name),
         case when m.custom_name is not null and m.dish_id is null and m.pack_id is null then 'Off-menu dish — chef must add its ingredients as extra needs'
              when m.dish_id is not null and r.dish_id is null then 'No standard recipe yet'
              when m.dish_id is not null and r.status <> 'verified' then 'Recipe is still a draft — verify it to include it'
              when m.pack_id is not null and not exists (select 1 from pack_components pc where pc.pack_id = m.pack_id) then 'Packed-meal set has no dishes' end
  from event_menu m left join dishes d on d.id = m.dish_id left join recipes r on r.dish_id = m.dish_id left join pack_sets ps on ps.id = m.pack_id
  where m.event_id = p_event
    and ((m.custom_name is not null and m.dish_id is null and m.pack_id is null) or (m.dish_id is not null and (r.dish_id is null or r.status <> 'verified'))
         or (m.pack_id is not null and not exists (select 1 from pack_components pc where pc.pack_id = m.pack_id)))
$$;

-- refresh "times booked" on the standard dish list from real events
create or replace function refresh_dish_stats() returns void language sql security definer set search_path = public as $$
  update dishes d set times_booked = coalesce(x.n, 0)
  from (select d2.id, count(distinct m.event_id) as n from dishes d2 left join event_menu m on m.dish_id = d2.id
        left join events e on e.id = m.event_id and e.status <> 'cancelled' group by d2.id) x
  where x.id = d.id;
$$;

-- Public website form → bookings (the only thing an anonymous visitor can do)
create or replace function submit_booking(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare r text := next_doc_no('BK');
begin
  if length(p::text) > 20000 then raise exception 'Too large'; end if;
  insert into bookings(ref, payload, client_name, phone, email, event_date, pax, event_type)
  values (r, p, left(p #>> '{customer,name}', 120), left(p #>> '{customer,phone}', 40), left(p #>> '{customer,email}', 120),
          nullif(p #>> '{event,date}', '')::date, nullif(p #>> '{event,pax}', '')::int, left(p #>> '{event,type}', 60));
  return r;
end $$;

-- Add a menu line from typed text (event sheets, website bookings, imports):
-- "Cordon Bleu and Garlic Fried Chicken" becomes two standard dishes when both are known;
-- anything unknown is kept as an off-menu dish for the chef.
create or replace function add_menu_text(p_event uuid, p_course text, p_text text, p_qty numeric default null) returns int
language plpgsql security definer set search_path = public as $$
declare d uuid; parts text[]; ids uuid[] := '{}'; x text; n int := 0;
begin
  perform require_role('catering', array['coordinator', 'manager', 'chef']::app_role[]);
  p_text := btrim(regexp_replace(p_text, '\s+', ' ', 'g'));
  if p_text = '' then return 0; end if;
  d := find_dish(p_text);
  if d is null then
    parts := regexp_split_to_array(p_text, '\s*(?:,|&|\yand\y|/)\s*', 'i');
    foreach x in array parts loop
      if btrim(x) = '' then continue; end if;
      if find_dish(x) is null then ids := null; exit; end if;
      ids := ids || find_dish(x);
    end loop;
  end if;
  if d is not null then
    insert into event_menu(event_id, course, dish_id, qty) values (p_event, coalesce(nullif(p_course, ''), (select course from dishes where id = d)), d, p_qty); n := 1;
  elsif ids is not null and cardinality(ids) > 1 then
    insert into event_menu(event_id, course, dish_id, qty, note) select p_event, coalesce(nullif(p_course, ''), (select course from dishes where id = u)), u, p_qty, 'from: ' || p_text from unnest(ids) u;
    n := cardinality(ids);
  else
    insert into event_menu(event_id, course, custom_name, qty) values (p_event, coalesce(nullif(p_course, ''), 'Main'), p_text, p_qty); n := 1;
  end if;
  return n;
end $$;
