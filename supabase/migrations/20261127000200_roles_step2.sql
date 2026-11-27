-- Roles, step 2 of 2 (run after step 1). Narrower, clearer roles:
--   * Creating events and handling website inquiries: Owner, Manager, Event specialist. Coordinators still edit events
--     (menu, details, print) but can't create them or take inquiries.
--   * Recipes and dish details (incl. tray price): Owner, Head chef, R&D chef only. Everyone else reads.
--   * Kitchen stocks daily count: Storekeeper (the stockist) and Manager. Other Restaurant roles see the 86 / running-low list.
-- Safe to run more than once.
begin;

-- Events and inquiries
drop policy if exists "write" on events;
create policy "write" on events for insert with check (has_role('catering', array['event_specialist', 'manager']::app_role[]));
drop policy if exists "edit" on events;
create policy "edit" on events for update using (has_role('catering', array['event_specialist', 'coordinator', 'manager', 'finance']::app_role[]) and status <> 'closed')
  with check (status <> 'closed' or has_role('catering', array['manager', 'finance']::app_role[]));
drop policy if exists "handle" on bookings;
create policy "handle" on bookings for update using (has_role('catering', array['event_specialist', 'manager']::app_role[]));
drop policy if exists "write" on event_menu;
create policy "write" on event_menu for all
  using (has_role('catering', array['event_specialist', 'coordinator', 'manager', 'chef', 'head_chef']::app_role[]) and exists (select 1 from events e where e.id = event_id and e.status not in ('done', 'closed', 'cancelled')))
  with check (has_role('catering', array['event_specialist', 'coordinator', 'manager', 'chef', 'head_chef']::app_role[]) and exists (select 1 from events e where e.id = event_id and e.status not in ('done', 'closed', 'cancelled')));
drop policy if exists "write" on event_extra_needs;
create policy "write" on event_extra_needs for all using (has_role('catering', array['chef', 'head_chef', 'manager']::app_role[])) with check (has_role('catering', array['chef', 'head_chef', 'manager']::app_role[]));

create or replace function create_event_from_booking(p_booking uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare b bookings; p jsonb; c uuid; e uuid; it jsonb; k event_kind; crs text; nm text;
begin
  perform require_role('catering', array['event_specialist', 'manager']::app_role[]);
  select * into b from bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.event_id is not null then return b.event_id; end if;
  p := b.payload;
  k := case when b.kind = 'tray' then 'trays' else 'buffet' end;
  select id into c from clients where phone is not null and phone = b.phone limit 1;
  if c is null then
    insert into clients(name, kind, phone, email, contact)
    values (coalesce(nullif(b.client_name, ''), 'Website client'), case when b.kind = 'corporate' then 'corporate' else 'individual' end, b.phone, b.email,
            nullif(p #>> '{corp,company}', '')) returning id into c;
  end if;
  nm := coalesce(nullif(p #>> '{corp,company}', ''), b.client_name, 'Website client');
  insert into events(kind, client_id, title, event_type, event_date, serve_time, venue, pax, status, booking_id, coordinator, sheet)
  values (k, c, left(nm || coalesce(' · ' || nullif(b.event_type, ''), ''), 120), nullif(b.event_type, ''),
          coalesce(b.event_date, current_date + 14),
          case when (p #>> '{event,time}') ~ '^\d{1,2}:\d{2}' then (p #>> '{event,time}')::time end,
          nullif(p #>> '{event,venue}', ''), case when k = 'buffet' then b.pax end, 'inquiry', b.id, auth.uid(),
          jsonb_strip_nulls(jsonb_build_object('notes', p ->> 'notes', 'plan', p -> 'plan', 'estimate', p -> 'estimate', 'website_ref', b.website_ref,
                                               'date_missing', case when b.event_date is null then true end)))
  returning id into e;
  for it in select * from jsonb_array_elements(coalesce(p -> 'items', '[]')) loop
    crs := case it ->> 'cat' when 'soup' then 'Soup' when 'appetizer' then 'Salad / appetizer' when 'veg' then 'Vegetables'
                when 'pasta' then 'Pasta / noodles' when 'dessert' then 'Dessert' when 'drinks' then 'Drinks' when 'rice' then 'Rice'
                when 'chicken' then 'Main' when 'pork' then 'Main' when 'beef' then 'Main' when 'fish' then 'Main' else null end;
    if coalesce(btrim(it ->> 'dish'), '') <> '' then
      perform add_menu_text(e, crs, it ->> 'dish', case when k = 'trays' and (it ->> 'qty') ~ '^\d+(\.\d+)?$' then (it ->> 'qty')::numeric end);
    end if;
  end loop;
  update bookings set event_id = e, status = case when status = 'new' then 'contacted' else status end, handled_by = auth.uid() where id = b.id;
  return e;
end $$;

create or replace function generate_event_pr(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e events; pr purchase_requests; r record; already numeric; add_qty numeric; n int := 0; warn jsonb; res numeric;
begin
  perform require_role('catering', array['coordinator', 'event_specialist', 'manager', 'chef', 'head_chef']::app_role[]);
  select * into e from events where id = p_event for update;
  if e.status in ('closed', 'cancelled', 'done') then raise exception 'Event is %', e.status; end if;
  -- reuse an open draft PR for this event; a new one is only created once there is something to buy
  select * into pr from purchase_requests where event_id = p_event and source = 'event_auto' and status = 'draft' order by created_at desc limit 1;
  for r in select * from event_requirements(p_event) loop
    -- reserve what the catering store already has for this event
    res := least(r.needed, r.free_stock);
    insert into stock_reservations(event_id, item_id, qty) values (p_event, r.item_id, res)
    on conflict (event_id, item_id) do update set qty = excluded.qty;
    -- subtract what earlier (non-cancelled) requests for this event already asked for
    select coalesce(sum(coalesce(l.approved_qty, l.qty)), 0) into already
      from pr_lines l join purchase_requests q on q.id = l.pr_id
     where q.event_id = p_event and q.id is distinct from pr.id and q.status not in ('rejected', 'cancelled') and l.item_id = r.item_id;
    add_qty := r.to_buy - already;
    -- countable things are bought whole: 13.3 cans → 14 cans
    if add_qty > 0 and r.unit in ('pc', 'pack', 'can', 'bundle', 'bottle', 'tray', 'box', 'case') then add_qty := ceil(add_qty - 0.0001); end if;
    add_qty := round(add_qty, 3);
    if add_qty > 0 then
      if pr.id is null then
        insert into purchase_requests(ws, event_id, source, needed_by, purpose)
        values ('catering', p_event, 'event_auto', e.event_date - 1,
                'Auto from ' || e.ref || ' · ' || e.title || coalesce(' · ' || e.pax || ' guests', ''))
        returning * into pr;
      end if;
      insert into pr_lines(pr_id, item_id, qty, est_unit_cost, on_hand_then, note)
      values (pr.id, r.item_id, add_qty, (select last_cost from items where id = r.item_id), r.free_stock, 'for: ' || r.from_dishes)
      on conflict (pr_id, item_id) do update set qty = excluded.qty, est_unit_cost = excluded.est_unit_cost, on_hand_then = excluded.on_hand_then, note = excluded.note;
      n := n + 1;
    elsif pr.id is not null then
      delete from pr_lines where pr_id = pr.id and item_id = r.item_id;
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('dish', w.dish, 'problem', w.problem)), '[]') into warn from event_warnings(p_event) w;
  if pr.id is null or not exists (select 1 from pr_lines where pr_id = pr.id) then
    if pr.id is not null then delete from purchase_requests where id = pr.id; end if;
    return jsonb_build_object('pr', null, 'lines', 0, 'warnings', warn,
      'message', case when jsonb_array_length(warn) > 0 then 'Nothing to request yet for the dishes that could be calculated — fix the warnings'
                      else 'Everything needed is already in the catering store or already requested' end);
  end if;
  return jsonb_build_object('pr', pr.pr_no, 'pr_id', pr.id, 'lines', (select count(*) from pr_lines where pr_id = pr.id), 'warnings', warn);
end $$;

-- Recipes and dish details: Head chef and R&D chef (the owner always can)
drop policy if exists "write" on dishes;
create policy "write" on dishes for all using (has_role_any(array['head_chef', 'rnd_chef']::app_role[])) with check (has_role_any(array['head_chef', 'rnd_chef']::app_role[]));
drop policy if exists "write" on dish_aliases;
create policy "write" on dish_aliases for all using (has_role_any(array['head_chef', 'rnd_chef']::app_role[])) with check (has_role_any(array['head_chef', 'rnd_chef']::app_role[]));
drop policy if exists "write" on recipes;
create policy "write" on recipes for all using (has_role_any(array['head_chef', 'rnd_chef']::app_role[]))
  with check (has_role_any(array['head_chef', 'rnd_chef']::app_role[]) and (status = 'draft' or verified_by = auth.uid()));
drop policy if exists "write" on recipe_lines;
create policy "write" on recipe_lines for all using (has_role_any(array['head_chef', 'rnd_chef']::app_role[])) with check (has_role_any(array['head_chef', 'rnd_chef']::app_role[]));

create or replace function verify_recipe(p_dish uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_missing text;
begin
  if not has_role_any(array['head_chef', 'rnd_chef']::app_role[]) then raise exception 'Only the head chef or R&D chef can verify recipes' using errcode = '42501'; end if;
  if not exists (select 1 from recipe_lines where dish_id = p_dish) then raise exception 'Recipe has no ingredients'; end if;
  select string_agg(i.name, ', ' order by i.name) into v_missing
    from recipe_lines rl join items i on i.id = rl.item_id where rl.dish_id = p_dish and rl.qty = 0;
  if v_missing is not null then raise exception 'Fill in the quantity for: %', v_missing; end if;
  update recipes set status = 'verified', verified_by = auth.uid(), verified_at = now() where dish_id = p_dish;
end $$;

create or replace function recipe_line_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update recipes set status = 'draft', verified_by = null, verified_at = null, updated_at = now()
  where dish_id = coalesce(new.dish_id, old.dish_id) and status = 'verified' and not has_role_any(array['head_chef', 'rnd_chef']::app_role[]);
  update recipes set updated_at = now() where dish_id = coalesce(new.dish_id, old.dish_id);
  return coalesce(new, old);
end $$;

create or replace function can_edit_menu() returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or has_role_any(array['head_chef', 'rnd_chef']::app_role[]) $$;

-- Restaurant menu, prices & par: Manager, Head chef, Chef
drop policy if exists "write" on restaurant_menu;
create policy "write" on restaurant_menu for all using (has_role('restaurant', array['manager', 'head_chef', 'chef']::app_role[])) with check (has_role('restaurant', array['manager', 'head_chef', 'chef']::app_role[]));

-- Kitchen stocks: the stockist (Storekeeper) and Manager count; POS sales still subtract on their own
drop policy if exists "insert" on dish_day_counts;
drop policy if exists "update" on dish_day_counts;
create policy "insert" on dish_day_counts for insert with check (has_role('restaurant', array['storekeeper', 'manager']::app_role[]));
create policy "update" on dish_day_counts for update using (has_role('restaurant', array['storekeeper', 'manager']::app_role[])) with check (has_role('restaurant', array['storekeeper', 'manager']::app_role[]));
drop policy if exists "write" on kitchen_days;
create policy "write" on kitchen_days for all using (has_role('restaurant', array['storekeeper', 'manager']::app_role[])) with check (has_role('restaurant', array['storekeeper', 'manager']::app_role[]));

commit;
