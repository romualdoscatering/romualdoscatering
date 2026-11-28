-- Utility role: non-food supplies, equipment for both workspaces (counts + breakage reports), cleaning checklists.
-- Run 25_utility_role.sql first, on its own.

/* ---------- 1. Non-food supplies ---------- */
-- An item is non-food when its category is one of these (they show on the Supplies page)
alter table items add column if not exists nonfood boolean
  generated always as (category in ('Cleaning', 'Disposables & packaging', 'Paper & tissue', 'LPG & fuel', 'Kitchen supplies', 'Office & others')) stored;

-- A count can cover only non-food supplies (what Utility counts)
alter table stock_counts add column if not exists scope text not null default 'all' check (scope in ('all', 'nonfood'));

create or replace function can_count(p_ws workspace, p_scope text) returns boolean language sql stable security definer set search_path = public as $$
  select has_role(p_ws, array['storekeeper', 'manager', 'chef']::app_role[]) or (p_scope = 'nonfood' and has_role(p_ws, array['utility']::app_role[]))
$$;
grant execute on function can_count(workspace, text) to authenticated;

drop policy if exists "start" on stock_counts;
create policy "start" on stock_counts for insert with check (can_count(ws, scope) and status = 'open');
drop policy if exists "edit open count" on stock_counts;
create policy "edit open count" on stock_counts for update using (status = 'open' and can_count(ws, scope))
  with check (status = 'open' and posted_at is null and loss_value is null and gain_value is null);
drop policy if exists "count" on stock_count_lines;
create policy "count" on stock_count_lines for all
  using (exists (select 1 from stock_counts c where c.id = stock_count_lines.count_id and c.status = 'open' and can_count(c.ws, c.scope)
                 and (c.scope = 'all' or exists (select 1 from items i where i.id = stock_count_lines.item_id and i.nonfood))))
  with check (expected is null and exists (select 1 from stock_counts c where c.id = stock_count_lines.count_id and c.status = 'open' and can_count(c.ws, c.scope)
                 and (c.scope = 'all' or exists (select 1 from items i where i.id = stock_count_lines.item_id and i.nonfood))));

create or replace function post_count(p_count uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare c stock_counts; l record; exp numeric; loss numeric := 0; gain numeric := 0; d numeric; cost numeric;
begin
  select * into c from stock_counts where id = p_count for update;
  if c.id is null or c.status <> 'open' then raise exception 'Count not found or already posted'; end if;
  if not (is_admin() or can_count(c.ws, c.scope)) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if c.ws = 'catering' then perform set_config('rom.loc', coalesce(c.loc, main_kitchen()), true); end if;
  for l in select s.* from stock_count_lines s join items i on i.id = s.item_id where s.count_id = p_count and (c.scope = 'all' or i.nonfood) loop
    exp := case when c.ws = 'catering' then on_hand_at(l.item_id, coalesce(c.loc, main_kitchen())) else on_hand(c.ws, l.item_id) end;
    update stock_count_lines set expected = exp where count_id = p_count and item_id = l.item_id;
    d := l.counted - exp;
    if d <> 0 then
      select last_cost into cost from items where id = l.item_id;
      insert into stock_moves(ws, item_id, kind, qty, unit_cost, ref_type, ref_id, reason)
      values (c.ws, l.item_id, 'count_adjust', d, cost, 'count', p_count::text, case when d < 0 then 'missing at count' else 'excess at count' end);
      if d < 0 then loss := loss + d * cost; else gain := gain + d * cost; end if;
    end if;
  end loop;
  update stock_counts set status = 'posted', posted_at = now(), loss_value = round(loss, 2), gain_value = round(gain, 2) where id = p_count;
  return jsonb_build_object('loss_value', round(loss, 2), 'gain_value', round(gain, 2));
end $$;

-- Supplies on hand vs par, without prices (Utility sees quantities only)
create or replace function supplies_status(p_ws workspace) returns jsonb language sql stable security definer set search_path = public as $$
  select case when not (member_of(p_ws) or is_admin()) then '[]'::jsonb else coalesce(jsonb_agg(r order by r.category, r.name), '[]') end from (
    select i.id, i.name, i.category, i.stock_unit as unit, round(on_hand(p_ws, i.id), 3) as on_hand, p.par_qty as par, coalesce(p.order_up_to, p.par_qty) as up_to
    from items i left join item_par p on p.item_id = i.id and p.ws = p_ws
    where i.active and i.nonfood) r
$$;
grant execute on function supplies_status(workspace) to authenticated;

-- A purchase request for every non-food supply below par (Utility, storekeeper, manager)
create or replace function generate_supplies_pr(p_ws workspace) returns jsonb language plpgsql security definer set search_path = public as $$
declare pr purchase_requests; r record; n int := 0;
begin
  if not (is_admin() or has_role(p_ws, array['utility', 'storekeeper', 'manager']::app_role[])) then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into purchase_requests(ws, source, needed_by, purpose, requested_by)
  values (p_ws, 'par_restock', (now() at time zone 'Asia/Manila')::date + 1, 'Non-food supplies below par', auth.uid()) returning * into pr;
  for r in select p.item_id, coalesce(p.order_up_to, p.par_qty) as target, on_hand(p_ws, p.item_id) as oh, p.par_qty
           from item_par p join items i on i.id = p.item_id where p.ws = p_ws and i.active and i.nonfood and p.par_qty > 0 loop
    if r.oh < r.par_qty then
      insert into pr_lines(pr_id, item_id, qty, est_unit_cost, on_hand_then) values (pr.id, r.item_id, round(r.target - r.oh, 3), (select last_cost from items where id = r.item_id), r.oh);
      n := n + 1;
    end if;
  end loop;
  if n = 0 then delete from purchase_requests where id = pr.id; return jsonb_build_object('pr', null, 'lines', 0); end if;
  return jsonb_build_object('pr', pr.pr_no, 'pr_id', pr.id, 'lines', n);
end $$;
grant execute on function generate_supplies_pr(workspace) to authenticated;

-- A starting list of supplies (rename, add or switch off on the Items page; set par levels per store)
insert into items(name, category, stock_unit, purchase_unit, units_per_purchase, last_cost) values
  ('Dishwashing liquid', 'Cleaning', 'L', 'L', 1, 0), ('Bleach', 'Cleaning', 'L', 'L', 1, 0), ('Degreaser', 'Cleaning', 'L', 'L', 1, 0),
  ('Sanitizer', 'Cleaning', 'L', 'L', 1, 0), ('Sponge and scouring pad', 'Cleaning', 'pc', 'pc', 1, 0), ('Garbage bags', 'Cleaning', 'pc', 'pack', 1, 0),
  ('Food containers (take-out)', 'Disposables & packaging', 'pc', 'pack', 1, 0), ('Plastic utensils', 'Disposables & packaging', 'pc', 'pack', 1, 0),
  ('Cling wrap', 'Disposables & packaging', 'roll', 'roll', 1, 0), ('Aluminum foil', 'Disposables & packaging', 'roll', 'roll', 1, 0),
  ('Disposable gloves', 'Disposables & packaging', 'box', 'box', 1, 0), ('Hairnets', 'Disposables & packaging', 'pc', 'pack', 1, 0),
  ('Table napkins (paper)', 'Paper & tissue', 'pack', 'pack', 1, 0), ('Toilet tissue', 'Paper & tissue', 'roll', 'roll', 1, 0),
  ('LPG tank (11 kg)', 'LPG & fuel', 'tank', 'tank', 1, 0), ('Chafing fuel (gel)', 'LPG & fuel', 'can', 'can', 1, 0)
on conflict do nothing;

/* ---------- 2. Equipment for both workspaces ---------- */
alter table equipment add column if not exists ws workspace not null default 'catering';
drop index if exists equipment_name;
create unique index if not exists equipment_ws_name on equipment (ws, lower(name));

create or replace function equip_team_ws(p_ws workspace) returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or case when p_ws = 'catering'
    then has_role('catering', array['manager', 'event_specialist', 'coordinator', 'storekeeper', 'head_chef', 'chef', 'driver', 'utility']::app_role[])
    else has_role('restaurant', array['manager', 'storekeeper', 'head_chef', 'chef', 'utility']::app_role[]) end
$$;
create or replace function equip_team() returns boolean language sql stable security definer set search_path = public as $$ select equip_team_ws('catering') $$;
create or replace function equip_boss(p_ws workspace) returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or has_role(p_ws, array['manager', 'head_chef', 'storekeeper']::app_role[])
$$;
grant execute on function equip_team_ws(workspace), equip_boss(workspace) to authenticated;

drop policy if exists "read" on equipment; create policy "read" on equipment for select using (member_of(ws) or is_admin());
-- Adding equipment and changing how many we own: managers, head chef, storekeeper (everyone on the team can count and report)
drop policy if exists "add" on equipment;  create policy "add" on equipment for insert with check (equip_boss(ws));
drop policy if exists "edit" on equipment; create policy "edit" on equipment for update using (equip_boss(ws)) with check (equip_boss(ws));

-- Counts of equipment and smallwares
create table if not exists equipment_counts (
  id uuid primary key default gen_random_uuid(), ws workspace not null, counted_at timestamptz not null default now(),
  counted_by uuid default auth.uid(), note text check (length(note) <= 300)
);
create table if not exists equipment_count_lines (
  count_id uuid not null references equipment_counts(id) on delete cascade, equipment_id uuid not null references equipment(id) on delete cascade,
  counted integer not null check (counted >= 0), primary key (count_id, equipment_id)
);
alter table equipment_counts enable row level security; alter table equipment_count_lines enable row level security;
drop policy if exists "read" on equipment_counts; create policy "read" on equipment_counts for select using (member_of(ws) or is_admin());
drop policy if exists "add" on equipment_counts;  create policy "add" on equipment_counts for insert with check (equip_team_ws(ws));
drop policy if exists "read" on equipment_count_lines; create policy "read" on equipment_count_lines for select using (exists (select 1 from equipment_counts c where c.id = count_id and (member_of(c.ws) or is_admin())));
drop policy if exists "add" on equipment_count_lines;  create policy "add" on equipment_count_lines for insert with check (exists (select 1 from equipment_counts c where c.id = count_id and equip_team_ws(c.ws) and c.counted_at > now() - interval '1 day'));
grant select, insert on equipment_counts, equipment_count_lines to authenticated;

-- Breakage and loss reports: anyone in the workspace can report; managers, head chef or storekeeper close them
create table if not exists equipment_breakage (
  id uuid primary key default gen_random_uuid(), ws workspace not null, equipment_id uuid not null references equipment(id) on delete restrict,
  qty integer not null check (qty between 1 and 500), kind text not null default 'broken' check (kind in ('broken', 'missing')),
  event_id uuid references events(id) on delete set null, note text check (length(note) <= 300),
  photo text check (photo is null or (photo like 'data:image/jpeg;base64,%' and length(photo) < 200000)),
  reported_by uuid default auth.uid(), reported_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'replaced', 'written_off')), resolved_by uuid, resolved_at timestamptz
);
create index if not exists equipment_breakage_open on equipment_breakage (ws, status);
alter table equipment_breakage enable row level security;
drop policy if exists "read" on equipment_breakage; create policy "read" on equipment_breakage for select using (member_of(ws) or is_admin());
drop policy if exists "report" on equipment_breakage; create policy "report" on equipment_breakage for insert
  with check ((member_of(ws) or is_admin()) and status = 'open' and resolved_by is null and reported_by = auth.uid());
grant select, insert on equipment_breakage to authenticated;

-- Close a report: replaced (bought again, we still own the same number) or written off (we now own fewer)
create or replace function breakage_resolve(p_id uuid, p_status text) returns void language plpgsql security definer set search_path = public as $$
declare b equipment_breakage;
begin
  select * into b from equipment_breakage where id = p_id for update;
  if b.id is null then raise exception 'Report not found'; end if;
  if not equip_boss(b.ws) then raise exception 'Only a manager, the head chef or the storekeeper can close breakage reports' using errcode = '42501'; end if;
  if b.status <> 'open' then raise exception 'Already closed'; end if;
  if p_status not in ('replaced', 'written_off') then raise exception 'Use replaced or written_off'; end if;
  update equipment_breakage set status = p_status, resolved_by = auth.uid(), resolved_at = now() where id = p_id;
  if p_status = 'written_off' then update equipment set owned = greatest(0, owned - b.qty) where id = b.equipment_id; end if;
end $$;
grant execute on function breakage_resolve(uuid, text) to authenticated;

-- Where everything is, per workspace: owned, out at events, broken (open reports), last count
create or replace function equipment_status(p_ws workspace) returns jsonb language sql stable security definer set search_path = public as $$
  select case when not (member_of(p_ws) or is_admin()) then '[]'::jsonb else coalesce(jsonb_agg(r order by r.category, r.name), '[]') end from (
    select q.id, q.name, q.category, q.owned, q.active,
      (select coalesce(sum(case when x.out_qty is not null and x.back_qty is null then x.out_qty end), 0) from event_equipment x where x.equipment_id = q.id) as out_now,
      (select coalesce(sum(case when x.back_qty is not null and x.back_qty < x.out_qty then x.out_qty - x.back_qty end), 0) from event_equipment x where x.equipment_id = q.id) as missing,
      (select coalesce(sum(x.qty), 0) from event_equipment x join events e on e.id = x.event_id
         where x.equipment_id = q.id and x.out_qty is null and e.event_date >= current_date and e.status not in ('cancelled', 'closed')) as booked,
      (select coalesce(sum(b.qty), 0) from equipment_breakage b where b.equipment_id = q.id and b.status = 'open') as broken,
      (select jsonb_build_object('at', c.counted_at, 'n', l.counted) from equipment_count_lines l join equipment_counts c on c.id = l.count_id
         where l.equipment_id = q.id order by c.counted_at desc limit 1) as last_count,
      (select jsonb_agg(jsonb_build_object('event_id', e2.id, 'client', coalesce((select c.name from clients c where c.id = e2.client_id), e2.title, ''), 'date', e2.event_date, 'out', x2.out_qty, 'back', x2.back_qty) order by e2.event_date desc)
         from event_equipment x2 join events e2 on e2.id = x2.event_id
         where x2.equipment_id = q.id and x2.out_qty is not null and (x2.back_qty is null or x2.back_qty < x2.out_qty)) as where_now
    from equipment q where q.ws = p_ws) r
$$;
create or replace function equipment_status() returns jsonb language sql stable security definer set search_path = public as $$ select equipment_status('catering') $$;
grant execute on function equipment_status(workspace) to authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'equipment_breakage'::regclass) then
    create trigger audit after insert or update or delete on equipment_breakage for each row execute function audit_trigger(); end if;
end $$;

-- Restaurant smallwares and equipment to start with (set how many you own on the Equipment page)
insert into equipment(ws, name, category) values
  ('restaurant', 'Dinner plate', 'Plates and bowls'), ('restaurant', 'Rice plate', 'Plates and bowls'), ('restaurant', 'Soup bowl', 'Plates and bowls'),
  ('restaurant', 'Sizzling plate', 'Plates and bowls'), ('restaurant', 'Serving platter', 'Plates and bowls'),
  ('restaurant', 'Drinking glass', 'Glassware'), ('restaurant', 'Pitcher', 'Glassware'),
  ('restaurant', 'Spoon', 'Cutlery'), ('restaurant', 'Fork', 'Cutlery'), ('restaurant', 'Serving spoon', 'Cutlery'),
  ('restaurant', 'Frying pan', 'Kitchen'), ('restaurant', 'Stock pot', 'Kitchen'), ('restaurant', 'Wok', 'Kitchen'), ('restaurant', 'Chef knife', 'Kitchen'),
  ('restaurant', 'Chopping board', 'Kitchen'), ('restaurant', 'Tray (service)', 'Service'), ('restaurant', 'Table cloth', 'Linens')
on conflict do nothing;

/* ---------- 3. Cleaning checklists ---------- */
create table if not exists clean_tasks (
  id uuid primary key default gen_random_uuid(), ws workspace not null,
  area text not null check (length(area) between 1 and 40), task text not null check (length(task) between 1 and 160),
  shift text not null default 'closing' check (shift in ('opening', 'closing', 'anytime')),
  sort integer not null default 100, active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists clean_ticks (
  task_id uuid not null references clean_tasks(id) on delete cascade, tick_date date not null,
  done_by uuid not null default auth.uid(), done_at timestamptz not null default now(), note text check (length(note) <= 200),
  primary key (task_id, tick_date)
);
alter table clean_tasks enable row level security; alter table clean_ticks enable row level security;

create or replace function clean_boss(p_ws workspace) returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or has_role(p_ws, array['manager', 'head_chef']::app_role[])
$$;
grant execute on function clean_boss(workspace) to authenticated;
drop policy if exists "read" on clean_tasks;  create policy "read" on clean_tasks for select using (member_of(ws) or is_admin());
drop policy if exists "edit" on clean_tasks;  create policy "edit" on clean_tasks for all using (clean_boss(ws)) with check (clean_boss(ws));
drop policy if exists "read" on clean_ticks;  create policy "read" on clean_ticks for select using (exists (select 1 from clean_tasks t where t.id = task_id and (member_of(t.ws) or is_admin())));
drop policy if exists "tick" on clean_ticks;  create policy "tick" on clean_ticks for insert
  with check (done_by = auth.uid() and tick_date between (now() at time zone 'Asia/Manila')::date - 1 and (now() at time zone 'Asia/Manila')::date
              and exists (select 1 from clean_tasks t where t.id = task_id and t.active and (member_of(t.ws) or is_admin())));
drop policy if exists "untick" on clean_ticks; create policy "untick" on clean_ticks for delete
  using (exists (select 1 from clean_tasks t where t.id = task_id and (clean_boss(t.ws) or (done_by = auth.uid() and tick_date = (now() at time zone 'Asia/Manila')::date))));
grant select, insert, update, delete on clean_tasks to authenticated;
grant select, insert, delete on clean_ticks to authenticated;

-- One day's checklist with who did what
create or replace function clean_day(p_ws workspace, p_date date) returns jsonb language sql stable security definer set search_path = public as $$
  select case when not (member_of(p_ws) or is_admin()) then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'area', t.area, 'task', t.task, 'shift', t.shift, 'sort', t.sort,
    'done_at', k.done_at, 'done_by', k.done_by, 'who', p.full_name, 'note', k.note) order by t.shift, t.area, t.sort, t.task), '[]') end
  from clean_tasks t left join clean_ticks k on k.task_id = t.id and k.tick_date = p_date left join profiles p on p.id = k.done_by
  where t.ws = p_ws and t.active
$$;
grant execute on function clean_day(workspace, date) to authenticated;

-- Starting checklists, based on the utility and kitchen duties in the Job Roles doc (edit on the Cleaning page)
insert into clean_tasks(ws, area, task, shift, sort)
select w.ws, x.area, x.task, x.shift, x.sort from (values ('restaurant'::workspace), ('catering'::workspace)) w(ws)
cross join (values
  ('Kitchen', 'Check LPG, burners and exhaust before cooking', 'opening', 10),
  ('Kitchen', 'Sanitize prep tables and chopping boards', 'opening', 20),
  ('Kitchen', 'Check chiller and freezer temperatures', 'opening', 30),
  ('Kitchen', 'Wash and put away pots, pans and utensils', 'closing', 10),
  ('Kitchen', 'Degrease stove top and hood', 'closing', 20),
  ('Kitchen', 'Clean sinks and clear floor drains', 'closing', 30),
  ('Kitchen', 'Sweep and mop kitchen floor', 'closing', 40),
  ('Kitchen', 'Turn off LPG and burners', 'closing', 50),
  ('Garbage area', 'Separate garbage: biodegradable, recyclable, residual', 'closing', 10),
  ('Garbage area', 'Take out garbage and wash the bins', 'closing', 20),
  ('Storage', 'Label and date leftovers and prepped items (FIFO)', 'closing', 10)
) x(area, task, shift, sort)
where not exists (select 1 from clean_tasks);
insert into clean_tasks(ws, area, task, shift, sort)
select 'restaurant', x.area, x.task, x.shift, x.sort from (values
  ('Dining area', 'Wipe tables and chairs', 'opening', 10),
  ('Dining area', 'Refill condiments, napkins and tissue', 'opening', 20),
  ('Dining area', 'Sweep and mop dining floor', 'closing', 10),
  ('Comfort rooms', 'Clean toilets and sinks; refill soap and tissue', 'opening', 10),
  ('Comfort rooms', 'Check and clean comfort rooms', 'closing', 10)
) x(area, task, shift, sort)
where not exists (select 1 from clean_tasks where ws = 'restaurant' and area = 'Dining area');
insert into clean_tasks(ws, area, task, shift, sort)
select 'catering', 'Equipment', x.task, 'anytime', x.sort from (values
  ('Wash and dry chafing dishes and food pans after each event', 10),
  ('Launder linens and table skirting after each event', 20),
  ('Report broken or missing equipment in the app', 30)
) x(task, sort)
where not exists (select 1 from clean_tasks where ws = 'catering' and area = 'Equipment');
