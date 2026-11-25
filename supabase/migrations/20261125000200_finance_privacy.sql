-- Money is only for finance, catering managers and the owner. People who only encode events (coordinators, chefs,
-- purchasers, storekeepers) see no contract price, no costing or margin, no statements, payments or payment status.
begin;
-- The contract price moves out of `events` (which every catering member can read) into `event_finance`.

create table if not exists event_finance (
  event_id       uuid primary key references events(id) on delete cascade deferrable initially deferred,
  contract_price numeric(12,2) check (contract_price is null or contract_price >= 0),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references profiles(id) default auth.uid()
);
alter table event_finance enable row level security;
drop policy if exists "all" on event_finance;
create policy "all" on event_finance for all using (can_bill()) with check (can_bill());
grant select, insert, update, delete on event_finance to authenticated;

insert into event_finance(event_id, contract_price)
select id, contract_price from events where contract_price is not null
on conflict (event_id) do update set contract_price = excluded.contract_price;

-- events.contract_price stays empty from now on. A biller who still writes it is redirected to event_finance;
-- anyone else is refused.
create or replace function events_contract_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.contract_price is not null then
    if not can_bill() then raise exception 'Only finance, managers and the owner can set the contract price'; end if;
    insert into event_finance(event_id, contract_price) values (new.id, new.contract_price)
    on conflict (event_id) do update set contract_price = excluded.contract_price, updated_at = now(), updated_by = auth.uid();
    new.contract_price := null;
  end if;
  return new;
end $$;
drop trigger if exists contract_guard on events;
create trigger contract_guard before insert or update of contract_price on events for each row execute function events_contract_guard();
update events set contract_price = null where contract_price is not null;

-- Costing: amounts only for billers (the view runs with the reader's rights, so event_finance is empty for others too)
create or replace view event_costing with (security_invoker = true) as
select e.id as event_id, e.ref, e.title, e.event_date, e.pax, f.contract_price,
       (case when can_bill() then coalesce(-sum(m.qty * m.unit_cost) filter (where m.kind in ('issue', 'return')), 0) end)::numeric(12,2) as ingredients_used,
       (case when can_bill() then coalesce((select sum(x.amount) from expenses x where x.event_id = e.id and x.status = 'ok'), 0) end)::numeric(12,2) as expenses,
       (case when can_bill() then coalesce(-sum(m.qty * m.unit_cost) filter (where m.kind in ('issue', 'return')), 0)
        + coalesce((select sum(x.amount) from expenses x where x.event_id = e.id and x.status = 'ok'), 0) end)::numeric(12,2) as total_cost
from events e left join stock_moves m on m.event_id = e.id and m.ws = 'catering' left join event_finance f on f.event_id = e.id
group by e.id, f.contract_price;

-- Payment status: billers only (was: status for every catering member)
create or replace function event_money(p_events uuid[])
returns table(event_id uuid, soa_no text, total numeric, paid numeric, balance numeric, status text, due date)
language sql stable security definer set search_path = public as $$
  with b as (
    select e.id, eb.soa_no, eb.due,
           greatest(0, coalesce((select sum(round(l.rate * coalesce(l.qty, e.pax, 0), 2)) from bill_lines l where l.event_id = e.id), 0) - coalesce(eb.discount, 0)) as total,
           coalesce((select sum(p.amount) from event_payments p where p.event_id = e.id and p.voided_at is null), 0) as paid,
           eb.event_id is not null as has_bill
    from events e left join event_bills eb on eb.event_id = e.id
    where e.id = any(p_events) and can_bill()
  )
  select id, soa_no, total, paid, total - paid,
         case when not has_bill and paid = 0 then 'none' when paid = 0 then 'unpaid' when paid < total then 'partial' when paid > total then 'over' else 'paid' end,
         due
  from b
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'event_finance'::regclass) then
    create trigger audit after insert or update or delete on event_finance for each row execute function audit_trigger();
  end if;
end $$;
commit;
