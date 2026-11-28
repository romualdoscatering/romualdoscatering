-- Fix: event specialists can create events but were blocked from saving the event's client
-- and from typing dishes into a menu (rules left over from before the role split).
drop policy if exists "write" on clients;
create policy "write" on clients for all
  using (has_role('catering', array['event_specialist', 'coordinator', 'manager', 'finance']::app_role[]))
  with check (has_role('catering', array['event_specialist', 'coordinator', 'manager', 'finance']::app_role[]));

CREATE OR REPLACE FUNCTION public.add_menu_text(p_event uuid, p_course text, p_text text, p_qty numeric DEFAULT NULL::numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d uuid; parts text[]; ids uuid[] := '{}'; x text; n int := 0;
begin
  perform require_role('catering', array['event_specialist', 'coordinator', 'manager', 'chef']::app_role[]);
  p_text := btrim(regexp_replace(p_text, '\s+', ' ', 'g'));
  if p_text = '' then return 0; end if;
  d := find_dish(p_text);
  if d is null then
    parts := regexp_split_to_array(p_text, '\s*(?:,|&|\yand\y|/)\s*', 'i');
    foreach x in array parts loop
      if btrim(x) = '' then continue; end if;
      if find_dish(x) is null then ids := null; exit; end if;
      ids := ids || find_dish(x);
    end loop;
  end if;
  if d is not null then
    insert into event_menu(event_id, course, dish_id, qty) values (p_event, coalesce(nullif(p_course, ''), (select course from dishes where id = d)), d, p_qty); n := 1;
  elsif ids is not null and cardinality(ids) > 1 then
    insert into event_menu(event_id, course, dish_id, qty, note) select p_event, coalesce(nullif(p_course, ''), (select course from dishes where id = u)), u, p_qty, 'from: ' || p_text from unnest(ids) u;
    n := cardinality(ids);
  else
    insert into event_menu(event_id, course, custom_name, qty) values (p_event, coalesce(nullif(p_course, ''), 'Main'), p_text, p_qty); n := 1;
  end if;
  return n;
end $function$

;
