-- Driver runs, the production sheet, and the approvals inbox + owner dashboard. Run after the driver role file.
-- Safe to run more than once.

-- ================= Driver runs =================
create table if not exists event_runs (
  event_id   uuid primary key references events(id) on delete cascade,
  driver     uuid references profiles(id),
  status     text not null default 'planned' check (status in ('planned', 'loaded', 'left', 'arrived', 'handed_over')),
  loaded_at  timestamptz,
  left_at    timestamptz,
  arrived_at timestamptz,
  done_at    timestamptz,
  proof_img  text check (proof_img is null or (proof_img like 'data:image/jpeg;base64,%' and length(proof_img) < 200000)),
  note       text check (note is null or length(note) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table event_runs enable row level security;   -- read and changed only through the functions below
revoke insert, update, delete on event_runs from authenticated, anon;
drop trigger if exists audit on event_runs;           -- the proof photo stays out of the Activity log; each step is logged below

create or replace function run_team() returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or has_role('catering', array['event_specialist', 'coordinator', 'manager', 'driver']::app_role[])
$$;
create or replace function run_planner() returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or has_role('catering', array['event_specialist', 'coordinator', 'manager']::app_role[])
$$;

-- The day's runs: every event that goes out (buffet on site, or delivery), with what the driver needs
create or replace function runs_for(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not run_team() then raise exception 'Only drivers and the event team can see runs'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'ref', e.ref, 'title', e.title, 'client', coalesce(c.name, e.title), 'kind', e.kind, 'pax', e.pax,
      'event_date', e.event_date, 'serve_time', e.serve_time, 'status', e.status, 'fulfil', e.sheet ->> 'fulfil',
      'venue', e.venue, 'venue_place', e.venue_place, 'venue_lat', e.venue_lat, 'venue_lng', e.venue_lng, 'kitchen', e.kitchen,
      'travel_mins', t.mins, 'travel_km', t.km, 'travel_source', t.source,
      'contact', coalesce(nullif(e.sheet ->> 'contact', ''), c.name), 'mobile', coalesce(nullif(e.sheet ->> 'mobile', ''), c.phone),
      'coord', e.sheet ->> 'coord', 'call', e.sheet ->> 'call', 'equip', e.sheet ->> 'equip', 'special', e.sheet ->> 'special',
      'items', (select count(*) from event_menu m where m.event_id = e.id),
      'driver', r.driver, 'driver_name', coalesce(nullif(btrim(dp.nickname), ''), split_part(dp.full_name, ' ', 1)),
      'run_status', coalesce(r.status, 'planned'), 'loaded_at', r.loaded_at, 'left_at', r.left_at, 'arrived_at', r.arrived_at, 'done_at', r.done_at,
      'has_proof', r.proof_img is not null, 'run_note', r.note
    ) order by e.serve_time nulls last)
    from events e left join clients c on c.id = e.client_id left join event_travel t on t.event_id = e.id
    left join event_runs r on r.event_id = e.id left join profiles dp on dp.id = r.driver
    where e.event_date = p_date and e.status not in ('cancelled', 'closed', 'inquiry')
      and (e.kind = 'buffet' or e.sheet ->> 'fulfil' = 'Delivery')
  ), '[]'::jsonb);
end $$;

-- Who can drive: people with the Driver role (plus anyone already assigned)
create or replace function run_drivers() returns table (id uuid, name text, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(btrim(p.nickname), ''), split_part(p.full_name, ' ', 1)), p.full_name
  from profiles p where p.active and run_team() and exists (select 1 from memberships m where m.user_id = p.id and m.role = 'driver')
  order by p.full_name
$$;

create or replace function run_assign(p_event uuid, p_driver uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not run_planner() then raise exception 'Only the event team can assign a driver'; end if;
  insert into event_runs(event_id, driver, updated_by) values (p_event, p_driver, auth.uid())
  on conflict (event_id) do update set driver = excluded.driver, updated_at = now(), updated_by = auth.uid();
  insert into audit_log(actor, tbl, row_id, action, new_row) values (auth.uid(), 'event_runs', p_event::text, 'UPDATE', jsonb_build_object('event_id', p_event, 'driver', p_driver));
end $$;

-- Mark a step: loaded → left → arrived → handed_over (or back to planned to undo). Photo optional, on hand-over.
create or replace function run_step(p_event uuid, p_status text, p_note text, p_img text) returns void
language plpgsql security definer set search_path = public as $$
declare r event_runs;
begin
  if p_status not in ('planned', 'loaded', 'left', 'arrived', 'handed_over') then raise exception 'Unknown step'; end if;
  select * into r from event_runs where event_id = p_event;
  if not (run_planner() or (r.driver = auth.uid()) or (r.driver is null and has_role('catering', array['driver']::app_role[]))) then
    raise exception 'Only the assigned driver or the event team can update this run'; end if;
  insert into event_runs(event_id, driver) values (p_event, case when has_role('catering', array['driver']::app_role[]) then auth.uid() end)
  on conflict (event_id) do nothing;
  update event_runs set status = p_status, updated_at = now(), updated_by = auth.uid(),
    driver     = coalesce(driver, case when has_role('catering', array['driver']::app_role[]) then auth.uid() end),
    loaded_at  = case when p_status = 'planned' then null when p_status = 'loaded' then now() else coalesce(loaded_at, case when p_status in ('left', 'arrived', 'handed_over') then now() end) end,
    left_at    = case when p_status in ('planned', 'loaded') then null when p_status = 'left' then now() else coalesce(left_at, case when p_status in ('arrived', 'handed_over') then now() end) end,
    arrived_at = case when p_status in ('planned', 'loaded', 'left') then null when p_status = 'arrived' then now() else coalesce(arrived_at, now()) end,
    done_at    = case when p_status = 'handed_over' then now() else null end,
    note       = coalesce(nullif(left(btrim(coalesce(p_note, '')), 300), ''), note),
    proof_img  = case when p_status = 'planned' then null else coalesce(p_img, proof_img) end
  where event_id = p_event;
  insert into audit_log(actor, tbl, row_id, action, new_row)
  values (auth.uid(), 'event_runs', p_event::text, 'UPDATE', jsonb_build_object('event_id', p_event, 'status', p_status, 'note', nullif(btrim(coalesce(p_note, '')), '')));
end $$;

create or replace function run_proof(p_event uuid) returns text language sql stable security definer set search_path = public as $$
  select proof_img from event_runs where event_id = p_event and run_team()
$$;

-- ================= Production sheet =================
-- Every dish on every event for a date, with the event's kitchen and timing; the app adds them up per kitchen.
create or replace function production_sheet(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or member_of('catering') or has_role('restaurant', array['manager', 'head_chef', 'chef']::app_role[])) then
    raise exception 'Only the kitchen and event teams can see the production sheet'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_id', e.id, 'ref', e.ref, 'client', coalesce(c.name, e.title), 'kind', e.kind, 'pax', e.pax, 'serve_time', e.serve_time,
      'event_date', e.event_date, 'status', e.status, 'kitchen', e.kitchen, 'fulfil', e.sheet ->> 'fulfil', 'allergy', e.sheet ->> 'allergy',
      'venue_lat', e.venue_lat, 'venue_lng', e.venue_lng, 'travel_mins', t.mins, 'travel_km', t.km, 'travel_source', t.source,
      'course', m.course, 'dish_id', m.dish_id, 'pack_id', m.pack_id,
      'name', coalesce(nullif(m.custom_name, ''), d.name, ps.name), 'qty', m.qty, 'servings', m.servings, 'note', m.note,
      'tray_serves', d.tray_serves
    ) order by e.serve_time nulls last, m.sort)
    from events e join event_menu m on m.event_id = e.id left join dishes d on d.id = m.dish_id left join pack_sets ps on ps.id = m.pack_id
    left join clients c on c.id = e.client_id left join event_travel t on t.event_id = e.id
    where e.event_date = p_date and e.status not in ('cancelled', 'closed', 'inquiry')
  ), '[]'::jsonb);
end $$;

-- ================= Approvals inbox =================
-- Everything waiting on a decision, limited to what the caller can act on.
create or replace function approvals_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mgr_c boolean := is_admin() or has_role('catering', array['manager']::app_role[]);
        mgr_r boolean := is_admin() or has_role('restaurant', array['manager']::app_role[]);
        fin boolean := is_admin() or has_role('catering', array['manager', 'finance']::app_role[]) or has_role('restaurant', array['manager', 'finance']::app_role[]);
        chef boolean := is_admin() or has_role_any(array['head_chef']::app_role[]);
        sales boolean := is_admin() or has_role('catering', array['manager', 'event_specialist']::app_role[]);
begin
  if not (mgr_c or mgr_r or fin or chef or sales) then raise exception 'Nothing to approve for your role'; end if;
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'no', p.pr_no, 'ws', p.ws, 'who', p.requested_by_name, 'at', p.submitted_at,
                     'total', p.est_total, 'lines', p.line_count, 'event', p.event_title, 'needed_by', p.needed_by, 'purpose', p.purpose, 'priority', p.priority) order by p.submitted_at)
                   from pr_overview p where p.status = 'submitted' and ((p.ws = 'catering' and mgr_c) or (p.ws = 'restaurant' and mgr_r))), '[]'),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'pr_id', r.pr_id, 'ws', r.ws, 'no', q.pr_no, 'supplier', r.supplier_text, 'at', r.submitted_at,
                     'who', (select full_name from profiles where id = r.submitted_by),
                     'total', (select coalesce(sum(l.qty * l.unit_cost), 0) from purchase_report_lines l where l.report_id = r.id and l.bought)) order by r.submitted_at)
                   from purchase_reports r join purchase_requests q on q.id = r.pr_id
                   where r.status = 'submitted' and ((r.ws = 'catering' and mgr_c) or (r.ws = 'restaurant' and mgr_r))), '[]'),
    'zreadings', case when mgr_r or fin then coalesce((select jsonb_agg(jsonb_build_object('date', s.sale_date, 'net', s.net) order by s.sale_date desc)
                   from daily_sales s where s.verified_by is null and s.sale_date > current_date - 30), '[]') else '[]' end,
    'advances', case when fin then coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'ws', a.ws, 'amount', a.amount, 'at', a.released_at,
                     'who', (select full_name from profiles where id = a.given_to)) order by a.released_at)
                   from cash_advances a where a.status = 'open' and a.released_at < now() - interval '2 days'), '[]') else '[]' end,
    'voids', case when mgr_r then coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'no', o.order_no, 'total', o.total, 'at', o.voided_at, 'reason', o.void_reason,
                     'paid', o.paid_at is not null, 'who', (select full_name from profiles where id = o.voided_by)) order by o.voided_at desc)
                   from pos_orders o where o.status = 'void' and o.voided_at > now() - interval '3 days'), '[]') else '[]' end,
    'recipes', case when chef then (select count(*) from recipes where status = 'draft') else 0 end,
    'inquiries', case when sales then (select count(*) from bookings where status = 'new') else 0 end,
    'counts', case when mgr_c or mgr_r then coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'ws', s.ws, 'at', s.counted_at, 'who', (select full_name from profiles where id = s.counted_by)) order by s.counted_at)
                   from stock_counts s where s.status = 'open' and s.counted_at < now() - interval '1 day'), '[]') else '[]' end
  );
end $$;

-- ================= Owner dashboard =================
create or replace function owner_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Manila')::date; res jsonb; money jsonb; evs uuid[];
begin
  if not (is_admin() or has_role('catering', array['manager', 'finance']::app_role[]) or has_role('restaurant', array['manager', 'finance']::app_role[])) then
    raise exception 'Owner and managers only'; end if;
  select array_agg(id) into evs from events where status not in ('cancelled', 'inquiry') and event_date between d - 90 and d + 60;
  select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object('client', coalesce(c.name, e.title), 'ref', e.ref, 'event_date', e.event_date) order by m.balance desc), '[]')
    into money from event_money(coalesce(evs, '{}')) m join events e on e.id = m.event_id left join clients c on c.id = e.client_id where m.balance > 0.5;
  res := jsonb_build_object(
    'today', d,
    'sales_today', (select to_jsonb(x) from pos_daily x where x.biz_date = d),
    'sales_lastweek', (select to_jsonb(x) from pos_daily x where x.biz_date = d - 7),
    'sales_7', (select coalesce(sum(net), 0) from pos_daily where biz_date between d - 6 and d),
    'sales_prev7', (select coalesce(sum(net), 0) from pos_daily where biz_date between d - 13 and d - 7),
    'sales_days', coalesce((select jsonb_agg(jsonb_build_object('d', g::date, 'net', coalesce(x.net, 0)) order by g)
                            from generate_series(d - 13, d, interval '1 day') g left join pos_daily x on x.biz_date = g::date), '[]'),
    'events_week', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'ref', e.ref, 'client', coalesce(c.name, e.title), 'date', e.event_date, 'time', e.serve_time,
                             'pax', e.pax, 'kind', e.kind, 'status', e.status) order by e.event_date, e.serve_time)
                            from events e left join clients c on c.id = e.client_id
                            where e.event_date between d and d + 6 and e.status not in ('cancelled', 'closed', 'inquiry')), '[]'),
    'balances', money,
    'food_cost', coalesce((select jsonb_agg(jsonb_build_object('id', x.event_id, 'ref', x.ref, 'title', x.title, 'date', x.event_date, 'contract', x.contract_price,
                             'cost', x.total_cost) order by x.event_date desc)
                           from event_costing x where x.event_date between d - 30 and d and x.contract_price > 0), '[]'),
    'k86', (select count(*) from kitchen_sheet(d) k where k.beginning + k.produced - k.pulled_out - k.sold <= 0),
    'klow', (select count(*) from kitchen_sheet(d) k where k.beginning + k.produced - k.pulled_out - k.sold > 0 and k.beginning + k.produced - k.pulled_out - k.sold < k.min_level),
    'below_par', (select count(*) from stock_on_hand s join item_par p on p.item_id = s.item_id and p.ws = s.ws where s.on_hand < p.par_qty),
    'inquiries', (select count(*) from bookings where status = 'new')
  );
  return res;
end $$;

revoke all on function run_team(), run_planner(), runs_for(date), run_drivers(), run_assign(uuid, uuid), run_step(uuid, text, text, text), run_proof(uuid),
  production_sheet(date), approvals_inbox(), owner_dashboard() from public, anon;
grant execute on function run_team(), run_planner(), runs_for(date), run_drivers(), run_assign(uuid, uuid), run_step(uuid, text, text, text), run_proof(uuid),
  production_sheet(date), approvals_inbox(), owner_dashboard() to authenticated;

-- Events board: also the run status (for "On the way" on every card)
create or replace function events_board(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_active_user()) then raise exception 'Sign in to see the events board.'; end if;
  if p_to < p_from or p_to - p_from > 120 then raise exception 'Choose up to 120 days.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'ref', e.ref, 'title', e.title, 'client', coalesce(c.name, e.sheet ->> 'client', e.title),
      'event_type', e.event_type, 'kind', e.kind, 'event_date', e.event_date, 'serve_time', e.serve_time,
      'venue', e.venue, 'pax', e.pax, 'status', e.status, 'venue_lat', e.venue_lat, 'venue_lng', e.venue_lng, 'kitchen', e.kitchen,
      'travel_mins', t.mins, 'travel_km', t.km, 'travel_source', t.source,
      'run_status', r.status, 'run_left_at', r.left_at, 'run_arrived_at', r.arrived_at, 'run_done_at', r.done_at,
      'fulfil', e.sheet ->> 'fulfil', 'call', e.sheet ->> 'call', 'pull', e.sheet ->> 'pull', 'pkg', e.sheet ->> 'pkg',
      'motif', e.sheet ->> 'motif', 'setup', e.sheet ->> 'setup', 'allergy', e.sheet ->> 'allergy', 'special', e.sheet ->> 'special',
      'menu', coalesce((select jsonb_agg(jsonb_build_object('course', m.course, 'name', coalesce(nullif(m.custom_name, ''), d.name, p.name),
                                                            'qty', m.qty, 'servings', m.servings, 'note', m.note) order by m.sort, m.course)
                        from event_menu m left join dishes d on d.id = m.dish_id left join pack_sets p on p.id = m.pack_id
                        where m.event_id = e.id), '[]'::jsonb)
    ) order by e.event_date, e.serve_time nulls last)
    from events e left join clients c on c.id = e.client_id left join event_travel t on t.event_id = e.id left join event_runs r on r.event_id = e.id
    where e.event_date between p_from and p_to and e.status not in ('cancelled', 'closed')
  ), '[]'::jsonb);
end $$;
revoke all on function events_board(date, date) from public, anon;
grant execute on function events_board(date, date) to authenticated;
