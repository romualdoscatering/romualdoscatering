-- My tasks: phone reminders even when the app is closed.
-- Run this AFTER the phone-notification setup (keys in Edge Function secrets + the poke-push function deployed — its URL ends in /clever-service).
-- Every minute, the database asks the function to send the reminders that are due. Safe to run more than once.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- A private key only the database and the function know (made here, never shown)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.secrets (key text primary key, value text not null);
insert into private.secrets(key, value) values ('cron_key', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function public.cron_key_ok(k text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.secrets where key = 'cron_key' and value = k)
$$;
revoke all on function public.cron_key_ok(text) from public, anon, authenticated;
grant execute on function public.cron_key_ok(text) to service_role;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'task-reminders') then perform cron.unschedule('task-reminders'); end if;
end $$;
select cron.schedule('task-reminders', '* * * * *', $job$
  select net.http_post(
    url := 'https://skqmlqujmjkzmiykkand.supabase.co/functions/v1/clever-service',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select value from private.secrets where key = 'cron_key')),
    body := '{"event":"reminders"}'::jsonb)
$job$);

-- Check: should list one job named task-reminders
select jobname, schedule, active from cron.job where jobname = 'task-reminders';
