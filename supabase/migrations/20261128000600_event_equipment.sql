-- Equipment checklist per event: what goes out (chafing dishes, linens, utensils…), what comes back, what is missing.

create table if not exists equipment (
  id        uuid primary key default gen_random_uuid(),
  name      text not null check (length(name) between 1 and 80),
  category  text not null default 'Other' check (length(category) <= 40),
  owned     integer not null default 0 check (owned >= 0),
  active    boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists equipment_name on equipment (lower(name));

create table if not exists event_equipment (
  event_id     uuid not null references events(id) on delete cascade,
  equipment_id uuid not null references equipment(id) on delete restrict,
  qty          integer not null default 0 check (qty >= 0),          -- needed
  out_qty      integer check (out_qty >= 0),                         -- packed / loaded
  back_qty     integer check (back_qty >= 0),                        -- returned to the kitchen
  out_at timestamptz, out_by uuid, back_at timestamptz, back_by uuid,
  note         text check (length(note) <= 200),
  primary key (event_id, equipment_id)
);
create index if not exists event_equipment_eq on event_equipment (equipment_id);

alter table equipment enable row level security;
alter table event_equipment enable row level security;

-- Who handles equipment: event team, kitchen, store, drivers
create or replace function equip_team() returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or has_role('catering', array['manager', 'event_specialist', 'coordinator', 'storekeeper', 'head_chef', 'chef', 'driver']::app_role[])
$$;
grant execute on function equip_team() to authenticated;

drop policy if exists "read" on equipment;       create policy "read" on equipment for select using (member_of('catering') or is_admin());
drop policy if exists "add" on equipment;        create policy "add" on equipment for insert with check (equip_team());
drop policy if exists "edit" on equipment;       create policy "edit" on equipment for update using (equip_team()) with check (equip_team());
drop policy if exists "read" on event_equipment; create policy "read" on event_equipment for select using (member_of('catering') or is_admin());
drop policy if exists "add" on event_equipment;  create policy "add" on event_equipment for insert with check (equip_team());
drop policy if exists "edit" on event_equipment; create policy "edit" on event_equipment for update using (equip_team()) with check (equip_team());
drop policy if exists "remove" on event_equipment; create policy "remove" on event_equipment for delete using (equip_team() and out_qty is null);
grant select, insert, update on equipment to authenticated;
grant select, insert, update, delete on event_equipment to authenticated;

-- Tick packed / returned. p_what = 'out' or 'back'; p_qty null = clear the tick.
create or replace function equip_check(p_event uuid, p_equipment uuid, p_what text, p_qty integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not equip_team() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_qty is not null and p_qty < 0 then raise exception 'Quantity can''t be negative'; end if;
  if p_what = 'out' then
    update event_equipment set out_qty = p_qty, out_at = case when p_qty is null then null else now() end, out_by = case when p_qty is null then null else auth.uid() end
    where event_id = p_event and equipment_id = p_equipment;
  elsif p_what = 'back' then
    update event_equipment set back_qty = p_qty, back_at = case when p_qty is null then null else now() end, back_by = case when p_qty is null then null else auth.uid() end
    where event_id = p_event and equipment_id = p_equipment;
  else raise exception 'Use out or back'; end if;
  if not found then raise exception 'Add the item to this event first'; end if;
end $$;
grant execute on function equip_check(uuid, uuid, text, integer) to authenticated;

-- Copy the list from the last event of the same kind (needed quantities only)
create or replace function equip_copy_last(p_event uuid) returns integer language plpgsql security definer set search_path = public as $$
declare src uuid; n int;
begin
  if not equip_team() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select e.id into src from events e
  where e.id <> p_event and exists (select 1 from event_equipment x where x.event_id = e.id)
  order by (e.kind = (select kind from events where id = p_event)) desc, e.event_date desc limit 1;
  if src is null then return 0; end if;
  insert into event_equipment(event_id, equipment_id, qty)
  select p_event, equipment_id, qty from event_equipment where event_id = src
  on conflict (event_id, equipment_id) do nothing;
  get diagnostics n = row_count; return n;
end $$;
grant execute on function equip_copy_last(uuid) to authenticated;

-- Where everything is: owned, out at events now, missing after events
create or replace function equipment_status() returns jsonb language sql stable security definer set search_path = public as $$
  select case when not (member_of('catering') or is_admin()) then '[]'::jsonb else coalesce(jsonb_agg(r order by r.category, r.name), '[]') end from (
    select q.id, q.name, q.category, q.owned, q.active,
      coalesce(sum(case when x.out_qty is not null and x.back_qty is null then x.out_qty end), 0) as out_now,
      coalesce(sum(case when x.back_qty is not null and x.back_qty < x.out_qty then x.out_qty - x.back_qty end), 0) as missing,
      coalesce(sum(case when x.out_qty is null and e.event_date >= current_date and e.status not in ('cancelled', 'closed') then x.qty end), 0) as booked,
      (select jsonb_agg(jsonb_build_object('event_id', e2.id, 'client', coalesce((select c.name from clients c where c.id = e2.client_id), e2.title, ''), 'date', e2.event_date, 'out', x2.out_qty, 'back', x2.back_qty) order by e2.event_date desc)
         from event_equipment x2 join events e2 on e2.id = x2.event_id
         where x2.equipment_id = q.id and x2.out_qty is not null and (x2.back_qty is null or x2.back_qty < x2.out_qty)) as where_now
    from equipment q left join event_equipment x on x.equipment_id = q.id left join events e on e.id = x.event_id
    group by q.id) r
$$;
grant execute on function equipment_status() to authenticated;

-- Events whose equipment has not all come back (for the home screen, the dashboard and the approvals inbox)
create or replace function equipment_open() returns jsonb language sql stable security definer set search_path = public as $$
  select case when not (member_of('catering') or is_admin()) then '[]'::jsonb else coalesce(jsonb_agg(t order by t.date), '[]') end from (
    select e.id, coalesce((select c.name from clients c where c.id = e.client_id), e.title, '') as client, e.event_date as date,
      sum(x.out_qty) filter (where x.back_qty is null) as not_back,
      sum(x.out_qty - x.back_qty) filter (where x.back_qty < x.out_qty) as missing
    from event_equipment x join events e on e.id = x.event_id
    where x.out_qty is not null and (x.back_qty is null or x.back_qty < x.out_qty) and e.event_date < current_date
    group by e.id) t
$$;
grant execute on function equipment_open() to authenticated;

-- Audit both tables
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'equipment'::regclass) then
    create trigger audit after insert or update or delete on equipment for each row execute function audit_trigger(); end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'event_equipment'::regclass) then
    create trigger audit after insert or update or delete on event_equipment for each row execute function audit_trigger(); end if;
end $$;

-- A starting list. Rename, add or remove on the Equipment page; set how many you own.
insert into equipment(name, category) values
  ('Chafing dish (full size)', 'Buffet'), ('Chafing dish (round)', 'Buffet'), ('Sterno / chafing fuel', 'Buffet'), ('Serving spoon', 'Utensils'),
  ('Serving tongs', 'Utensils'), ('Ladle', 'Utensils'), ('Food warmer / hot box', 'Transport'), ('Insulated food box', 'Transport'),
  ('Beverage dispenser', 'Drinks'), ('Ice bucket', 'Drinks'), ('Buffet table cloth', 'Linens'), ('Table skirting', 'Linens'),
  ('Napkins (cloth)', 'Linens'), ('Dinner plate', 'Tableware'), ('Spoon and fork set', 'Tableware'), ('Glass / tumbler', 'Tableware'),
  ('Tray (full)', 'Transport'), ('Extension cord', 'Other')
on conflict do nothing;
