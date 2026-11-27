-- Pokes: tell the sender when someone marks their poke done or replies. Safe to run more than once.
alter table pokes add column if not exists sender_seen_at timestamptz;   -- when the sender last looked at their Sent pokes

-- The bell: open pokes for me, plus "done / replied" news on pokes I sent
create or replace function poke_unread() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', (select count(*) from poke_to t join pokes k on k.id = t.poke_id where t.user_id = auth.uid() and t.done_at is null and k.cancelled_at is null),
    'unseen', (select count(*) from poke_to t join pokes k on k.id = t.poke_id where t.user_id = auth.uid() and t.seen_at is null and k.cancelled_at is null),
    'latest', (select jsonb_build_object('id', k.id, 'body', k.body, 'from', coalesce(nullif(btrim(p.nickname), ''), split_part(p.full_name, ' ', 1)), 'urgent', k.urgent)
               from poke_to t join pokes k on k.id = t.poke_id join profiles p on p.id = k.from_user
               where t.user_id = auth.uid() and t.seen_at is null and k.cancelled_at is null order by k.created_at desc limit 1),
    'replies', (select count(*) from poke_to t join pokes k on k.id = t.poke_id
                where k.from_user = auth.uid() and k.cancelled_at is null and t.done_at > coalesce(k.sender_seen_at, k.created_at)),
    'latest_reply', (select jsonb_build_object('key', k.id::text || t.user_id::text || t.done_at::text, 'body', k.body, 'reply', t.reply,
                       'from', coalesce(nullif(btrim(p.nickname), ''), split_part(p.full_name, ' ', 1)))
               from poke_to t join pokes k on k.id = t.poke_id join profiles p on p.id = t.user_id
               where k.from_user = auth.uid() and k.cancelled_at is null and t.done_at > coalesce(k.sender_seen_at, k.created_at)
               order by t.done_at desc limit 1))
$$;

-- The sender has looked at their Sent pokes: clears the "done / replied" news
create or replace function poke_sent_seen() returns void language sql security definer set search_path = public as $$
  update pokes k set sender_seen_at = now()
   where k.from_user = auth.uid()
     and exists (select 1 from poke_to t where t.poke_id = k.id and t.done_at > coalesce(k.sender_seen_at, k.created_at))
$$;

revoke all on function poke_sent_seen() from public, anon;
grant execute on function poke_sent_seen() to authenticated;
