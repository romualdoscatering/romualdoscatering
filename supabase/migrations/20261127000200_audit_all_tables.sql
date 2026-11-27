-- Romualdo's · every change is stamped with who and when
-- The audit log (who, when, what, before and after) now covers every table. Safe to run more than once.
-- Tables added later: re-run this file after their migration, or add the same trigger in it.

do $$ declare t text; begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('audit_log', 'doc_counters', 'push_subs', 'presence')   -- the log itself; document-number counters; phone notification keys; "in the app" pings
      and not exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
                      where g.tgrelid = c.oid and p.proname = 'audit_trigger')
  loop
    execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_trigger()', t);
  end loop;
end $$;

-- Rows without an "id" column (e.g. memberships, daily counts) are named by their key values instead of a blank
create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end; rid text;
begin
  rid := r ->> 'id';
  if rid is null then
    select string_agg(a.attname || '=' || coalesce(r ->> a.attname, ''), ' ' order by k.ord) into rid
    from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where i.indrelid = tg_relid and i.indisprimary;
  end if;
  insert into audit_log(actor, tbl, row_id, action, old_row, new_row)
  values (auth.uid(), tg_table_name, coalesce(rid, ''), tg_op,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- Fast look-ups for the Activity page
create index if not exists audit_log_at_idx on audit_log (at desc);
create index if not exists audit_log_actor_idx on audit_log (actor, at desc);
create index if not exists audit_log_row_idx on audit_log (tbl, row_id, at desc);

-- The staff password-reset function (Edge Function, server key) records each reset here too
grant insert on audit_log to service_role;
