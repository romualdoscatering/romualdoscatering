-- Romualdo's · POS only on registered tablets
-- The owner registers each POS tablet from that tablet (People → POS tablets). The tablet keeps a
-- secret key and sends it with every request in the x-pos-device header; only a hash is stored here.
-- Ringing up, sending to the kitchen, taking payment and opening the drawer then work only on a
-- registered tablet. The owner may use the POS anywhere. Managers may void a paid order and close the
-- drawer from any device (the Sales page). Safe to run more than once.

create table if not exists pos_devices (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 60),
  token_hash    text not null unique,
  registered_by uuid references profiles(id),
  registered_at timestamptz not null default now(),
  last_seen     timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid references profiles(id)
);
alter table pos_devices enable row level security;
drop policy if exists "owner reads" on pos_devices;
create policy "owner reads" on pos_devices for select using (is_admin());
revoke all on pos_devices from anon, authenticated;
grant select on pos_devices to authenticated;

-- The registered tablet making this request, or null
create or replace function pos_this_device() returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare tok text; h text; d uuid;
begin
  begin tok := nullif(trim(current_setting('request.headers', true)::json ->> 'x-pos-device'), '');
  exception when others then tok := null; end;
  if tok is null or length(tok) > 200 then return null; end if;
  h := encode(sha256(convert_to(tok, 'UTF8')), 'hex');
  select id into d from pos_devices where token_hash = h and revoked_at is null;
  if d is not null then
    update pos_devices set last_seen = now() where id = d and (last_seen is null or last_seen < now() - interval '5 minutes');
  end if;
  return d;
end $$;

create or replace function pos_require_tablet() returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if is_admin() then return; end if;
  if pos_this_device() is null then
    raise exception 'The POS works only on the restaurant''s registered tablet. Ask the owner to register this tablet (People → POS tablets).';
  end if;
end $$;

-- Orders: everything on the tablet, except a manager voiding or correcting an order that is no longer open
create or replace function pos_orders_tablet_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'open' and has_role('restaurant', array['manager']::app_role[]) then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'open' and new.status = 'void' and has_role('restaurant', array['manager']::app_role[]) then return new; end if;
  perform pos_require_tablet();
  return new;
end $$;
drop trigger if exists pos_orders_tablet_guard on pos_orders;
create trigger pos_orders_tablet_guard before insert or update on pos_orders
  for each row execute function pos_orders_tablet_guard();

-- Order lines (adding, changing, sending to the kitchen): tablet only
create or replace function pos_lines_tablet_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pos_require_tablet();
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists pos_lines_tablet_guard on pos_lines;
create trigger pos_lines_tablet_guard before insert or update or delete on pos_lines
  for each row execute function pos_lines_tablet_guard();

-- Cash drawer: open on the tablet; a manager may close it from anywhere
create or replace function pos_shifts_tablet_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and has_role('restaurant', array['manager']::app_role[]) then return new; end if;
  perform pos_require_tablet();
  return new;
end $$;
drop trigger if exists pos_shifts_tablet_guard on pos_shifts;
create trigger pos_shifts_tablet_guard before insert or update on pos_shifts
  for each row execute function pos_shifts_tablet_guard();

-- Owner: register the device this request comes from. Returns the secret key once; the tablet keeps it.
create or replace function pos_register_device(p_name text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare tok text;
begin
  if not is_admin() then raise exception 'Only the owner can register a POS tablet.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the tablet a name, e.g. Counter tablet.'; end if;
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into pos_devices(name, token_hash, registered_by, last_seen)
  values (trim(p_name), encode(sha256(convert_to(tok, 'UTF8')), 'hex'), auth.uid(), now());
  return tok;
end $$;

create or replace function pos_revoke_device(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the owner can remove a POS tablet.'; end if;
  update pos_devices set revoked_at = now(), revoked_by = auth.uid() where id = p_id and revoked_at is null;
end $$;

-- What the app shows: is this a registered tablet, and its name
create or replace function pos_device_status() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare d uuid;
begin
  d := pos_this_device();
  return jsonb_build_object('registered', d is not null, 'id', d, 'name', (select name from pos_devices where id = d));
end $$;

revoke all on function pos_this_device(), pos_require_tablet(), pos_orders_tablet_guard(), pos_lines_tablet_guard(), pos_shifts_tablet_guard() from public, anon, authenticated;
revoke all on function pos_register_device(text), pos_revoke_device(uuid), pos_device_status() from public, anon;
grant execute on function pos_register_device(text), pos_revoke_device(uuid), pos_device_status() to authenticated;

-- Record every change to the tablet list
do $$ begin
  if exists (select 1 from pg_proc where proname = 'audit_trigger') then
    execute 'drop trigger if exists audit on pos_devices';
    execute 'create trigger audit after insert or update or delete on pos_devices for each row execute function audit_trigger()';
  end if;
end $$;
