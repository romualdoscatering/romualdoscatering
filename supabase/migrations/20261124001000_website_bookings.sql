-- Website inquiries land in the app as bookings; a coordinator turns one into an event in one tap.
alter table bookings add column if not exists kind text;          -- package, custom, tray, corporate
alter table bookings add column if not exists website_ref text;   -- the reference the customer got (RC-…)
create index if not exists bookings_received on bookings(received_at desc);

-- Called by the public website (anon). Ignores bots, keeps one copy of a retried send, caps volume.
create or replace function submit_booking(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare r text; wref text := left(p ->> 'ref', 40); ph text := left(p #>> '{customer,phone}', 40);
begin
  if length(p::text) > 20000 then raise exception 'Too large'; end if;
  if coalesce(p ->> 'website', '') <> '' then return 'ok'; end if;                       -- honeypot filled = bot
  if coalesce(btrim(p #>> '{customer,name}'), '') = '' or coalesce(btrim(ph), '') = '' then raise exception 'Name and mobile are required'; end if;
  if (select count(*) from bookings where received_at > now() - interval '1 hour' and source = 'website') >= 60 then raise exception 'Too many inquiries right now'; end if;
  if wref is not null then
    select ref into r from bookings where website_ref = wref and phone is not distinct from ph limit 1;
    if r is not null then return r; end if;                                               -- retried send
  end if;
  r := next_doc_no('BK');
  insert into bookings(ref, website_ref, kind, payload, client_name, phone, email, event_date, pax, event_type)
  values (r, wref, left(p #>> '{plan,kind}', 20), p - 'website', left(p #>> '{customer,name}', 120), ph, left(p #>> '{customer,email}', 120),
          case when (p #>> '{event,date}') ~ '^\d{4}-\d{2}-\d{2}$' then (p #>> '{event,date}')::date end,
          case when (p #>> '{event,pax}') ~ '^\d{1,5}$' then (p #>> '{event,pax}')::int end,
          left(p #>> '{event,type}', 60));
  return r;
end $$;
revoke all on function submit_booking(jsonb) from public;
grant execute on function submit_booking(jsonb) to anon, authenticated;

-- Turn a booking into an event (status "inquiry"), with its client and menu
create or replace function create_event_from_booking(p_booking uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare b bookings; p jsonb; c uuid; e uuid; it jsonb; k event_kind; crs text; nm text;
begin
  perform require_role('catering', array['coordinator', 'manager']::app_role[]);
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
revoke all on function create_event_from_booking(uuid) from public, anon;
grant execute on function create_event_from_booking(uuid) to authenticated;
