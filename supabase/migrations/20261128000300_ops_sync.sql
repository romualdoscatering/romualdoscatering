-- /ops Event sheets → staff app events, kept in sync.
-- Every time someone saves an event sheet in /ops, the /ops server sends it here. The /ops sheet is the master copy
-- until the team moves to the app: client, date, time, venue, guests, status, sheet details and menu are updated from it.
-- Sheets that came from a website inquiry are joined to that inquiry (and to an event already made from it), never duplicated.
-- The /ops server proves who it is with a key it makes itself and registers once, within an hour of this file being run.
-- Safe to run more than once.

alter table events add column if not exists ops_id text;
create unique index if not exists events_ops_id on events(ops_id) where ops_id is not null;
comment on column events.ops_id is 'The /ops Event sheet this event is synced from (null = made in the app).';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.secrets (key text primary key, value text not null);
-- open the one-hour pairing window (only while /ops isn't linked yet)
insert into private.secrets(key, value)
select 'ops_pair_until', (now() + interval '1 hour')::text
where not exists (select 1 from private.secrets where key = 'ops_key_hash')
on conflict (key) do update set value = excluded.value;

create or replace function ops_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(length(p_key) >= 32 and exists (select 1 from private.secrets where key = 'ops_key_hash' and value = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')), false)
$$;

create or replace function ops_register(p_key text) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  if ops_key_ok(p_key) then return 'already linked'; end if;
  if exists (select 1 from private.secrets where key = 'ops_key_hash') then raise exception '/ops is already linked'; end if;
  if coalesce((select value::timestamptz from private.secrets where key = 'ops_pair_until'), now() - interval '1 second') < now() then
    raise exception 'Linking window closed: run the ops_sync update again to reopen it for an hour'; end if;
  if length(coalesce(p_key, '')) < 32 then raise exception 'Key too short'; end if;
  insert into private.secrets(key, value) values ('ops_key_hash', encode(sha256(convert_to(p_key, 'UTF8')), 'hex'));
  delete from private.secrets where key = 'ops_pair_until';
  return 'linked';
end $$;

create or replace function ops_sync_event(p_key text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_booking uuid; v_client uuid; v_status event_status; v_kind event_kind; v_sheet jsonb; m jsonb; i int := 0;
  v_name text := nullif(trim(p->'client'->>'name'), ''); v_phone text := nullif(trim(p->'client'->>'phone'), '');
begin
  if not ops_key_ok(p_key) then raise exception 'Not allowed'; end if;
  if coalesce(p->>'ops_id', '') = '' then raise exception 'ops_id missing'; end if;

  select id into v_id from events where ops_id = p->>'ops_id';
  if nullif(p->>'web_ref', '') is not null then
    select id, event_id into v_booking, v_id from bookings where website_ref = p->>'web_ref'
      and (v_id is null or event_id is null or event_id = v_id) order by received_at desc limit 1;
    if v_id is null then select id into v_id from events where ops_id = p->>'ops_id'; end if;
    if v_id is not null and exists (select 1 from events where id = v_id and ops_id is not null and ops_id <> p->>'ops_id') then
      select id into v_id from events where ops_id = p->>'ops_id'; end if;
  end if;

  -- deleted in /ops: cancel the app copy (finished events are left alone)
  if coalesce((p->>'deleted')::boolean, false) then
    if v_id is not null then update events set status = 'cancelled', ops_id = p->>'ops_id' where id = v_id and status not in ('done', 'closed'); end if;
    return v_id;
  end if;

  v_status := case p->>'status' when 'approval' then 'for_client_approval' when 'approved' then 'confirmed' when 'cancelled' then 'cancelled' else 'draft' end;
  v_kind := case p->>'kind' when 'trays' then 'trays' when 'packs' then 'packs' else 'buffet' end;

  if v_name is not null then
    select id into v_client from clients where lower(name) = lower(v_name) and coalesce(phone, '') = coalesce(v_phone, coalesce(phone, '')) order by created_at limit 1;
    if v_client is null then
      insert into clients(name, phone, email) values (v_name, v_phone, nullif(trim(p->'client'->>'email'), '')) returning id into v_client;
    end if;
  end if;

  v_sheet := coalesce(p->'sheet', '{}'::jsonb);
  if nullif(p->>'web_ref', '') is not null then v_sheet := v_sheet || jsonb_build_object('website_ref', p->>'web_ref'); end if;

  if v_id is null then
    insert into events(kind, title, event_type, event_date, serve_time, venue, pax, status, client_id, booking_id, sheet, ops_id)
    values (v_kind, coalesce(v_name, 'Event'), nullif(p->>'event_type', ''), (p->>'event_date')::date, nullif(p->>'serve_time', '')::time,
            nullif(p->>'venue', ''), nullif(p->>'pax', '')::int, v_status, v_client, v_booking, v_sheet, p->>'ops_id')
    returning id into v_id;
  else
    update events set kind = v_kind, title = coalesce(v_name, title), event_type = nullif(p->>'event_type', ''), event_date = (p->>'event_date')::date,
      serve_time = nullif(p->>'serve_time', '')::time, venue = nullif(p->>'venue', ''), pax = nullif(p->>'pax', '')::int,
      status = case when status in ('in_prep', 'done', 'closed') and v_status = 'confirmed' then status else v_status end,
      client_id = coalesce(v_client, client_id), booking_id = coalesce(v_booking, booking_id),
      sheet = coalesce(sheet, '{}'::jsonb) || v_sheet, ops_id = p->>'ops_id'
    where id = v_id;
  end if;
  if v_booking is not null then update bookings set event_id = v_id where id = v_booking and event_id is null; end if;

  -- the menu follows /ops (not once the event is done)
  if jsonb_typeof(p->'menu') = 'array' and not exists (select 1 from events where id = v_id and status in ('done', 'closed')) then
    delete from event_menu where event_id = v_id;
    for m in select * from jsonb_array_elements(p->'menu') loop
      continue when coalesce(trim(m->>'name'), '') = '';
      i := i + 1;
      insert into event_menu(event_id, course, dish_id, custom_name, qty, note, sort)
      values (v_id, coalesce(nullif(m->>'course', ''), 'Main'), find_dish(m->>'name'),
              case when find_dish(m->>'name') is null then trim(m->>'name') end,
              nullif(m->>'qty', '')::numeric, nullif(m->>'note', ''), i * 10);
    end loop;
  end if;
  return v_id;
end $$;

revoke all on function ops_register(text) from public;
revoke all on function ops_sync_event(text, jsonb) from public;
revoke all on function ops_key_ok(text) from public;
grant execute on function ops_register(text) to anon, authenticated;
grant execute on function ops_sync_event(text, jsonb) to anon, authenticated;

-- check: how many events are linked to /ops
select (select count(*) from events where ops_id is not null) as events_from_ops,
       (select case when exists (select 1 from private.secrets where key = 'ops_key_hash') then 'linked' else 'waiting for /ops (1 hour)' end) as link;
