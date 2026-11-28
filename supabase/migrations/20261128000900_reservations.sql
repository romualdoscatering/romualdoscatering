-- Restaurant reservations (tables, private room, whole-restaurant bookings, take-out and delivery group orders)
-- and the waiters' view-only screen: reservations + catering events for the day, without prices.

create table if not exists reservations (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique not null default next_doc_no('RS'),
  guest       text not null check (length(guest) between 1 and 120),
  contact     text check (length(contact) <= 60),
  res_date    date not null,
  time_in     time,
  time_out    time,
  pax         integer check (pax between 1 and 2000),
  area        text not null default 'Dining area' check (length(area) <= 60),
  table_no    text check (length(table_no) <= 40),
  occasion    text check (length(occasion) <= 80),
  status      text not null default 'tentative' check (status in ('tentative', 'confirmed', 'seated', 'done', 'no_show', 'cancelled')),
  hold_until  date,
  downpayment numeric(12,2) check (downpayment >= 0),
  preorder    text check (length(preorder) <= 2000),
  setup       text check (length(setup) <= 1000),
  allergy     text check (length(allergy) <= 300),
  note        text check (length(note) <= 1000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create index if not exists reservations_date on reservations (res_date);
alter table reservations enable row level security;

-- Who books: owner, restaurant manager, cashier, finance
create or replace function res_editor() returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or has_role('restaurant', array['manager', 'cashier', 'finance']::app_role[])
$$;
-- Who sees reservations: anyone in the restaurant, plus waiters on the catering side
create or replace function res_viewer() returns boolean language sql stable security definer set search_path = public as $$
  select member_of('restaurant') or has_role('catering', array['waiter', 'manager', 'event_specialist', 'coordinator']::app_role[])
$$;
grant execute on function res_editor(), res_viewer() to authenticated;

drop policy if exists "read" on reservations;  create policy "read" on reservations for select using (res_editor());
drop policy if exists "add" on reservations;   create policy "add" on reservations for insert with check (res_editor());
drop policy if exists "edit" on reservations;  create policy "edit" on reservations for update using (res_editor()) with check (res_editor());
grant select, insert, update on reservations to authenticated;

create or replace function reservations_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists reservations_touch on reservations;
create trigger reservations_touch before update on reservations for each row execute function reservations_touch();
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'reservations'::regclass) then
    create trigger audit after insert or update or delete on reservations for each row execute function audit_trigger(); end if;
end $$;

-- Waiters (and the rest of the floor) mark arrivals: seated, done, no-show
create or replace function reservation_mark(p_id uuid, p_status text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (res_editor() or has_role('restaurant', array['waiter', 'staff']::app_role[])) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_status not in ('confirmed', 'seated', 'done', 'no_show') then raise exception 'Use seated, done or no-show'; end if;
  update reservations set status = p_status where id = p_id and status <> 'cancelled';
end $$;
grant execute on function reservation_mark(uuid, text) to authenticated;

-- The floor's day: reservations plus catering events, no money for anyone who doesn't book
create or replace function service_day(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ed boolean := res_editor(); out jsonb;
begin
  if not res_viewer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_to - p_from > 62 then raise exception 'Pick a shorter range'; end if;
  select jsonb_build_object(
    'reservations', coalesce((select jsonb_agg(to_jsonb(r) - case when ed then '{}'::text[] else array['downpayment', 'contact'] end order by r.res_date, r.time_in nulls last)
                     from reservations r where r.res_date between p_from and p_to), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'ref', e.ref, 'date', e.event_date, 'time', e.serve_time, 'kind', e.kind, 'type', e.event_type,
                        'client', coalesce(c.name, e.title), 'pax', e.pax, 'venue', e.venue, 'status', e.status,
                        'staff', e.sheet->>'staff', 'setup', e.sheet->>'setup', 'call', e.sheet->>'call', 'allergy', e.sheet->>'allergy')
                        order by e.event_date, e.serve_time nulls last)
               from events e left join clients c on c.id = e.client_id
               where e.event_date between p_from and p_to and e.status not in ('cancelled', 'closed', 'inquiry')), '[]'),
    'editor', ed) into out;
  return out;
end $$;
grant execute on function service_day(date, date) to authenticated;
