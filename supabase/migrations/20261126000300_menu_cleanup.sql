-- Menu and ingredient clean-up (Recipes → Clean-up in the staff app). Managers, chefs and the owner.
--   merge_dishes  two dishes that are really one → everything moves to the one kept; the other name becomes an alias
--   delete_dish   only a dish that was never used (no event menu, POS sale or kitchen count); otherwise archive it
--   archive_dish  off the menu: hidden from the POS, new event menus and the dish list; history kept; can be restored
--   merge_items   two ingredients that are really one (same unit) → recipes, stock, requests and orders move over
--   delete_item   only an ingredient that was never used; otherwise archive it (items.active = false)
-- Every change is in the audit log.
begin;
create or replace function can_edit_menu() returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or has_role_any(array['manager', 'chef']::app_role[]) $$;

create or replace function merge_dishes(p_from uuid, p_into uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a dishes; b dishes; ra recipes; rb recipes; na int; nb int;
begin
  if not can_edit_menu() then raise exception 'Only a manager or chef can merge dishes.'; end if;
  if p_from = p_into then raise exception 'Pick two different dishes.'; end if;
  select * into a from dishes where id = p_from for update;
  select * into b from dishes where id = p_into for update;
  if a.id is null or b.id is null then raise exception 'Dish not found.'; end if;

  update event_menu set dish_id = p_into where dish_id = p_from;
  update pos_lines set dish_id = p_into where dish_id = p_from;
  -- kitchen counts on the same day: add them up
  update dish_day_counts t set beginning = t.beginning + f.beginning, produced = t.produced + f.produced, sold = t.sold + f.sold, pulled_out = t.pulled_out + f.pulled_out
    from dish_day_counts f where f.dish_id = p_from and t.dish_id = p_into and t.count_date = f.count_date;
  delete from dish_day_counts f where f.dish_id = p_from and exists (select 1 from dish_day_counts t where t.dish_id = p_into and t.count_date = f.count_date);
  update dish_day_counts set dish_id = p_into where dish_id = p_from;
  -- restaurant menu listing: keep the kept dish's own; otherwise take the other's
  if exists (select 1 from restaurant_menu where dish_id = p_into) then delete from restaurant_menu where dish_id = p_from;
  else update restaurant_menu set dish_id = p_into where dish_id = p_from; end if;
  -- recipe: keep the kept dish's recipe if it has ingredients, otherwise take the other's
  select * into ra from recipes where dish_id = p_from; select * into rb from recipes where dish_id = p_into;
  select count(*) into na from recipe_lines where dish_id = p_from; select count(*) into nb from recipe_lines where dish_id = p_into;
  if ra.dish_id is not null and (rb.dish_id is null or (nb = 0 and na > 0)) then
    delete from recipes where dish_id = p_into;
    insert into recipes select (jsonb_populate_record(null::recipes, to_jsonb(ra) || jsonb_build_object('dish_id', p_into))).*;
    update recipe_lines set dish_id = p_into where dish_id = p_from;
  end if;
  delete from recipes where dish_id = p_from;
  -- packed-meal sets
  update pack_components t set servings = t.servings + f.servings from pack_components f where f.dish_id = p_from and t.dish_id = p_into and t.pack_id = f.pack_id;
  delete from pack_components f where f.dish_id = p_from and exists (select 1 from pack_components t where t.pack_id = f.pack_id and t.dish_id = p_into);
  update pack_components set dish_id = p_into where dish_id = p_from;
  -- the old name keeps working when typed or imported
  update dish_aliases set dish_id = p_into where dish_id = p_from;
  insert into dish_aliases(alias, dish_id) values (lower(trim(a.name)), p_into) on conflict (alias) do update set dish_id = excluded.dish_id;
  update dishes set sold_as = (select array_agg(distinct x) from unnest(b.sold_as || a.sold_as) x),
    tray_price = coalesce(b.tray_price, a.tray_price), times_booked = b.times_booked + a.times_booked,
    standard = b.standard or a.standard, active = true, notes = nullif(concat_ws(E'\n', b.notes, a.notes), '')
  where id = p_into;
  delete from dishes where id = p_from;
  return b.name;
end $$;

create or replace function delete_dish(p_dish uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d dishes;
begin
  if not can_edit_menu() then raise exception 'Only a manager or chef can delete dishes.'; end if;
  select * into d from dishes where id = p_dish for update; if d.id is null then raise exception 'Dish not found.'; end if;
  if exists (select 1 from event_menu where dish_id = p_dish) or exists (select 1 from pos_lines where dish_id = p_dish)
     or exists (select 1 from dish_day_counts where dish_id = p_dish) or exists (select 1 from restaurant_menu where dish_id = p_dish) then
    raise exception '% is on the restaurant menu or has been used on events, POS sales or kitchen counts. Archive it instead (keeps the history), or merge it into the dish it duplicates.', d.name;
  end if;
  delete from pack_components where dish_id = p_dish;
  delete from dishes where id = p_dish;            -- recipe, aliases and menu listing go with it
  return d.name;
end $$;

create or replace function archive_dish(p_dish uuid, p_archive boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_edit_menu() then raise exception 'Only a manager or chef can archive dishes.'; end if;
  update dishes set active = not p_archive where id = p_dish;
  if p_archive then update restaurant_menu set on_pos = false, active = false where dish_id = p_dish; end if;
end $$;

create or replace function merge_items(p_from uuid, p_into uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a items; b items;
begin
  if not can_edit_menu() then raise exception 'Only a manager or chef can merge ingredients.'; end if;
  if p_from = p_into then raise exception 'Pick two different ingredients.'; end if;
  select * into a from items where id = p_from for update; select * into b from items where id = p_into for update;
  if a.id is null or b.id is null then raise exception 'Ingredient not found.'; end if;
  if lower(trim(a.stock_unit)) <> lower(trim(b.stock_unit)) then
    raise exception '% is in % but % is in %. Change one to the same unit first (✎ on the recipe page), then merge.', a.name, a.stock_unit, b.name, b.stock_unit;
  end if;
  -- tables keyed by item: add quantities together where both appear
  update recipe_lines t set qty = t.qty + f.qty from recipe_lines f where f.item_id = p_from and t.item_id = p_into and t.dish_id = f.dish_id;
  delete from recipe_lines f where f.item_id = p_from and exists (select 1 from recipe_lines t where t.item_id = p_into and t.dish_id = f.dish_id);
  update recipe_lines set item_id = p_into where item_id = p_from;
  update event_extra_needs t set qty = t.qty + f.qty from event_extra_needs f where f.item_id = p_from and t.item_id = p_into and t.event_id = f.event_id;
  delete from event_extra_needs f where f.item_id = p_from and exists (select 1 from event_extra_needs t where t.item_id = p_into and t.event_id = f.event_id);
  update event_extra_needs set item_id = p_into where item_id = p_from;
  update stock_reservations t set qty = t.qty + f.qty from stock_reservations f where f.item_id = p_from and t.item_id = p_into and t.event_id = f.event_id;
  delete from stock_reservations f where f.item_id = p_from and exists (select 1 from stock_reservations t where t.item_id = p_into and t.event_id = f.event_id);
  update stock_reservations set item_id = p_into where item_id = p_from;
  update stock_count_lines t set counted = t.counted + f.counted, expected = coalesce(t.expected, 0) + coalesce(f.expected, 0)
    from stock_count_lines f where f.item_id = p_from and t.item_id = p_into and t.count_id = f.count_id;
  delete from stock_count_lines f where f.item_id = p_from and exists (select 1 from stock_count_lines t where t.item_id = p_into and t.count_id = f.count_id);
  update stock_count_lines set item_id = p_into where item_id = p_from;
  delete from item_par f where f.item_id = p_from and exists (select 1 from item_par t where t.item_id = p_into and t.ws = f.ws);
  update item_par set item_id = p_into where item_id = p_from;
  -- history: just re-pointed
  update stock_moves set item_id = p_into where item_id = p_from;
  update pr_lines set item_id = p_into where item_id = p_from;
  update po_lines set item_id = p_into where item_id = p_from;
  update receipt_lines set item_id = p_into where item_id = p_from;
  update items set last_cost = case when b.last_cost > 0 then b.last_cost else a.last_cost end, active = true,
    category = case when b.category in ('Other', 'Others') then a.category else b.category end where id = p_into;
  delete from items where id = p_from;
  return b.name;
end $$;

create or replace function delete_item(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare i items; n int;
begin
  if not can_edit_menu() then raise exception 'Only a manager or chef can delete ingredients.'; end if;
  select * into i from items where id = p_item for update; if i.id is null then raise exception 'Ingredient not found.'; end if;
  select count(*) into n from recipe_lines where item_id = p_item;
  if n > 0 then raise exception '% is in % recipe(s). Remove it from them, or merge it into the ingredient it duplicates.', i.name, n; end if;
  if exists (select 1 from stock_moves where item_id = p_item) or exists (select 1 from pr_lines where item_id = p_item)
     or exists (select 1 from po_lines where item_id = p_item) or exists (select 1 from receipt_lines where item_id = p_item)
     or exists (select 1 from stock_count_lines where item_id = p_item) or exists (select 1 from event_extra_needs where item_id = p_item) then
    raise exception '% has stock or purchase history. Archive it instead, or merge it into the ingredient it duplicates.', i.name;
  end if;
  delete from stock_reservations where item_id = p_item;
  delete from items where id = p_item;
  return i.name;
end $$;

grant execute on function merge_dishes(uuid, uuid), delete_dish(uuid), archive_dish(uuid, boolean), merge_items(uuid, uuid), delete_item(uuid), can_edit_menu() to authenticated;
revoke execute on function merge_dishes(uuid, uuid), delete_dish(uuid), archive_dish(uuid, boolean), merge_items(uuid, uuid), delete_item(uuid) from anon;
commit;
