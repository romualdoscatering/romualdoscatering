-- Fix: re-running "Create / Update purchase request" on an event whose earlier request was already
-- submitted (no open draft) re-requested the FIRST ingredient a second time.
-- Cause: "q.id <> pr.id" is NULL while no draft exists yet, so for the first ingredient nothing was
-- counted as already requested. "is distinct from" treats "no draft yet" correctly.
create or replace function generate_event_pr(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e events; pr purchase_requests; r record; already numeric; add_qty numeric; n int := 0; warn jsonb; res numeric;
begin
  perform require_role('catering', array['coordinator', 'manager', 'chef']::app_role[]);
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
