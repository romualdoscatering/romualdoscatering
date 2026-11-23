-- One large tray serves 10–12 guests. Plan at 10 so buffets are never short:
-- tray contents stay the same, they are just counted as 10 servings instead of 12.
alter table dishes alter column tray_serves set default 10;
alter table recipes alter column batch_serves set default 10;
update dishes set tray_serves = 10 where tray_serves = 12;
update recipes set batch_serves = 10 where batch_serves = 12;

create or replace function menu_line_servings(m event_menu, e events) returns numeric
language sql stable as $$
  select case
    when m.servings is not null then m.servings
    when m.qty is not null and m.dish_id is not null then m.qty * coalesce((select tray_serves from dishes where id = m.dish_id), 10)
    when m.qty is not null and m.pack_id is not null then m.qty
    else coalesce(e.pax, 0) * coalesce((select share from course_rules where course = m.course), 1)
  end
$$;
