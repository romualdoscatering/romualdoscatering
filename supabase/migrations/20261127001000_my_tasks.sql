-- My tasks: a private to-do list for each team member, with their own lists, reminders and repeats.
-- Only the person who wrote a task can see it (not the owner, not managers) and tasks are not in the Activity log.
-- Safe to run more than once.

create table if not exists task_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references profiles(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 40),
  emoji      text check (emoji is null or length(emoji) <= 16),
  color      text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists task_lists_user_idx on task_lists (user_id, sort);

create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references profiles(id) on delete cascade,
  list_id       uuid references task_lists(id) on delete set null,
  title         text not null check (length(btrim(title)) between 1 and 200),
  notes         text check (notes is null or length(notes) <= 1000),
  due_date      date,
  due_time      time,
  priority      smallint not null default 0 check (priority in (0, 1)),            -- 1 = important
  repeat        text not null default 'none' check (repeat in ('none', 'daily', 'weekdays', 'weekly', 'monthly')),
  remind        text not null default 'none',                                       -- 'none' | 'at' | '10' | '30' | '60' | '1440' (minutes before) | 'custom'
  remind_at     timestamptz,                                                        -- when the reminder goes off
  reminded_at   timestamptz,                                                        -- when the phone was pinged
  done_at       timestamptz,
  from_poke     uuid,                                                               -- made from a poke
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tasks_user_idx on tasks (user_id, done_at, due_date);
create index if not exists tasks_remind_idx on tasks (remind_at) where reminded_at is null and done_at is null;

create table if not exists task_prefs (
  user_id    uuid primary key default auth.uid() references profiles(id) on delete cascade,
  prefs      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Only your own
alter table task_lists enable row level security;
alter table tasks enable row level security;
alter table task_prefs enable row level security;
drop policy if exists "own" on task_lists;
create policy "own" on task_lists for all using (user_id = auth.uid() and is_active_user()) with check (user_id = auth.uid() and is_active_user());
drop policy if exists "own" on tasks;
create policy "own" on tasks for all using (user_id = auth.uid() and is_active_user())
  with check (user_id = auth.uid() and is_active_user() and (list_id is null or exists (select 1 from task_lists l where l.id = list_id and l.user_id = auth.uid())));
drop policy if exists "own" on task_prefs;
create policy "own" on task_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on task_lists, tasks, task_prefs to authenticated;

-- Changing a task's reminder time re-arms the reminder; touch updated_at
create or replace function tasks_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.remind_at is distinct from old.remind_at then new.reminded_at := null; end if;
  return new;
end $$;
drop trigger if exists touch on tasks;
create trigger touch before insert or update on tasks for each row execute function tasks_touch();

-- Tick a task done. A repeating task gets its next one made at the same time.
create or replace function task_done(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t tasks; nd date; nid uuid;
begin
  select * into t from tasks where id = p_id and user_id = auth.uid() for update;
  if t.id is null then raise exception 'Task not found'; end if;
  if t.done_at is not null then return null; end if;
  update tasks set done_at = now() where id = p_id;
  if t.repeat <> 'none' and t.due_date is not null then
    nd := case t.repeat
      when 'daily' then t.due_date + 1
      when 'weekly' then t.due_date + 7
      when 'monthly' then (t.due_date + interval '1 month')::date
      when 'weekdays' then t.due_date + case extract(isodow from t.due_date)::int when 5 then 3 when 6 then 2 else 1 end
    end;
    -- don't make a pile of overdue copies: the next one is never before today
    while nd < (now() at time zone 'Asia/Manila')::date loop
      nd := case t.repeat when 'monthly' then (nd + interval '1 month')::date when 'weekly' then nd + 7
              when 'weekdays' then nd + case extract(isodow from nd)::int when 5 then 3 when 6 then 2 else 1 end else nd + 1 end;
    end loop;
    insert into tasks(user_id, list_id, title, notes, due_date, due_time, priority, repeat, remind, remind_at, sort)
    values (t.user_id, t.list_id, t.title, t.notes, nd, t.due_time, t.priority, t.repeat, t.remind,
            case when t.remind_at is not null then t.remind_at + (nd - t.due_date) * interval '1 day' end, t.sort)
    returning id into nid;
  end if;
  return nid;
end $$;
revoke all on function task_done(uuid) from public, anon;
grant execute on function task_done(uuid) to authenticated;

-- For the reminder job (service key only): reminders that are due now, marked as sent in the same step
create or replace function tasks_due_reminders() returns table (id uuid, user_id uuid, title text, due_date date, due_time time, priority smallint)
language sql security definer set search_path = public as $$
  update tasks t set reminded_at = now()
   where t.reminded_at is null and t.done_at is null and t.remind_at <= now() and t.remind_at > now() - interval '6 hours'
  returning t.id, t.user_id, t.title, t.due_date, t.due_time, t.priority
$$;
revoke all on function tasks_due_reminders() from public, anon, authenticated;
grant execute on function tasks_due_reminders() to service_role;

-- Keep personal tasks out of the Activity log (they're private)
do $$ begin
  execute 'drop trigger if exists audit on tasks';
  execute 'drop trigger if exists audit on task_lists';
  execute 'drop trigger if exists audit on task_prefs';
end $$;
