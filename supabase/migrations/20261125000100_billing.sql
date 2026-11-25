-- Catering billing: a Statement of Account per event (SOA-2026-0001), its priced lines, and every payment received
-- (deposit, balance, refunds are not handled here). Only finance, catering managers and the owner can see or change
-- amounts; everyone in catering can see an event's payment status (Unpaid / Partially paid / Paid in full).

create table if not exists bill_settings (
  id           int primary key default 1 check (id = 1),
  bill_address text not null default 'Door 1 LPS Bldg, Nacilla Village, Ma-a, Davao City 8000',
  bill_contact text not null default 'Mobile: (0995) 540-0308 · Email: romualdoscatering@gmail.com · Messenger: Jp Domingo',
  pay_info     text not null default '',      -- bank / GCash details printed on the statement
  due_days     int  not null default 0 check (due_days >= 0)   -- default due date = event date minus this many days (0 = on the event day)
);
insert into bill_settings(id) values (1) on conflict do nothing;

create table if not exists event_bills (
  event_id   uuid primary key references events(id) on delete cascade,
  soa_no     text unique not null default next_doc_no('SOA'),
  issued     date not null default (now() at time zone 'Asia/Manila')::date,
  due        date,
  bill_to    text,              -- blank = the client's name
  address    text,
  discount   numeric(12,2) not null default 0 check (discount >= 0),
  notes      text,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bill_lines (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null references event_bills(event_id) on delete cascade,
  sort     int not null default 0,
  label    text not null check (length(trim(label)) > 0),
  items    text,                                   -- menu shown under the line (one dish per line)
  rate     numeric(12,2) not null default 0 check (rate >= 0),
  qty      numeric(10,2) check (qty is null or qty >= 0),   -- blank = the event's guest count
  unit     text                                    -- head / tray / pack / blank
);
create index if not exists bill_lines_event on bill_lines(event_id, sort);

create table if not exists event_payments (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  paid_on     date not null default (now() at time zone 'Asia/Manila')::date,
  amount      numeric(12,2) not null check (amount > 0),
  method      text not null default 'cash' check (method in ('cash', 'gcash', 'bank', 'check', 'card', 'other')),
  ref         text,            -- GCash / bank reference, check no., OR/AR no.
  note        text,
  received_by uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid references profiles(id),
  void_reason text
);
create index if not exists event_payments_event on event_payments(event_id) where voided_at is null;

create or replace function can_bill() returns boolean
language sql stable security definer set search_path = public as $$
  select has_role('catering', array['manager', 'finance']::app_role[])
$$;

-- Totals per event. Amounts are returned only to people who can bill; the status goes to every catering member.
create or replace function event_money(p_events uuid[])
returns table(event_id uuid, soa_no text, total numeric, paid numeric, balance numeric, status text, due date)
language sql stable security definer set search_path = public as $$
  with b as (
    select e.id, eb.soa_no, eb.due,
           greatest(0, coalesce((select sum(round(l.rate * coalesce(l.qty, e.pax, 0), 2)) from bill_lines l where l.event_id = e.id), 0) - coalesce(eb.discount, 0)) as total,
           coalesce((select sum(p.amount) from event_payments p where p.event_id = e.id and p.voided_at is null), 0) as paid,
           eb.event_id is not null as has_bill
    from events e left join event_bills eb on eb.event_id = e.id
    where e.id = any(p_events) and member_of('catering')
  )
  select id,
         case when can_bill() then soa_no end,
         case when can_bill() then total end,
         case when can_bill() then paid end,
         case when can_bill() then total - paid end,
         case when not has_bill and paid = 0 then 'none'
              when paid = 0 then 'unpaid'
              when paid < total then 'partial'
              when paid > total then 'over'
              else 'paid' end,
         due
  from b
$$;

alter table bill_settings enable row level security;
alter table event_bills enable row level security;
alter table bill_lines enable row level security;
alter table event_payments enable row level security;

drop policy if exists "read" on bill_settings;   create policy "read" on bill_settings for select using (can_bill());
drop policy if exists "edit" on bill_settings;   create policy "edit" on bill_settings for update using (is_admin());
drop policy if exists "all" on event_bills;      create policy "all" on event_bills for all using (can_bill()) with check (can_bill());
drop policy if exists "all" on bill_lines;       create policy "all" on bill_lines for all using (can_bill()) with check (can_bill());
drop policy if exists "read" on event_payments;  create policy "read" on event_payments for select using (can_bill());
drop policy if exists "add" on event_payments;   create policy "add" on event_payments for insert with check (can_bill() and voided_at is null);
drop policy if exists "void" on event_payments;  create policy "void" on event_payments for update using (can_bill() and voided_at is null) with check (can_bill());

grant select on bill_settings to authenticated;
grant update (bill_address, bill_contact, pay_info, due_days) on bill_settings to authenticated;
grant select, insert, update, delete on event_bills, bill_lines to authenticated;
grant select, insert on event_payments to authenticated;
grant update (voided_at, voided_by, void_reason) on event_payments to authenticated;   -- payments are never edited or deleted, only voided

revoke execute on function can_bill(), event_money(uuid[]) from public, anon;
grant execute on function can_bill(), event_money(uuid[]) to authenticated;

do $$ declare t text; begin
  foreach t in array array['bill_settings', 'event_bills', 'bill_lines', 'event_payments'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = t::regclass) then
      execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_trigger()', t);
    end if;
  end loop;
end $$;
