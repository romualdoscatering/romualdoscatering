-- Recipes & pricing
-- 1. Chefs list every ingredient first and fill in quantities after: a recipe line may have no quantity yet (0).
--    A recipe can only be marked verified (and so used for purchase requests) once every quantity is filled in.
-- 2. Dishes get a menu tier: standard, premium or both (on both menu selections).
--    Pre-filled from the "Romualdo's Catering 2026" draft menu selections; change it on the dish page.

alter table recipe_lines drop constraint if exists recipe_lines_qty_check;
alter table recipe_lines add constraint recipe_lines_qty_check check (qty >= 0);
comment on column recipe_lines.qty is 'In the item''s stock unit, per batch. 0 = listed, quantity not filled in yet.';

create or replace function verify_recipe(p_dish uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_missing text;
begin
  if not has_role_any(array['chef', 'manager']::app_role[]) then raise exception 'Only a chef or manager can verify recipes' using errcode = '42501'; end if;
  if not exists (select 1 from recipe_lines where dish_id = p_dish) then raise exception 'Recipe has no ingredients'; end if;
  select string_agg(i.name, ', ' order by i.name) into v_missing
    from recipe_lines rl join items i on i.id = rl.item_id where rl.dish_id = p_dish and rl.qty = 0;
  if v_missing is not null then raise exception 'Fill in the quantity for: %', v_missing; end if;
  update recipes set status = 'verified', verified_by = auth.uid(), verified_at = now() where dish_id = p_dish;
end $$;

alter table dishes add column if not exists tier text check (tier in ('standard', 'premium', 'both'));
comment on column dishes.tier is 'Catering menu selection the dish belongs to: standard, premium or both. Empty = not on a package menu.';

do $$
declare
  std text[] := array['Creamy Mushroom','Creamy Corn','Egg Drop Soup','Molo Soup','Chicken Mami','Hinalang','Pochero','Pork Pochero','Beef Pochero',
    'Tea Sandwiches','Lumpia Ubod with Garlic Sauce','Lumpia Ubod','Assorted Finger Food','Tofu & Pork Ears','Tofu and Pork Ears','Chicken Skin','Baked Eggplant Roll','Bacon-Wrapped Hotdogs',
    'Sweet & Tangy Chicken','Chicken Curry','Chicken Pastel','Boneless Chicken Steak','Afritada','Chicken Afritada','Chopped Pinoy BBQ','Creamy Mushroom Chicken','Chicken Lumpia Shanghai',
    'Menudo','Humba','Binagoongan','Picadillo','Adobo','Pork Adobo','Hamonado','Bicol Express','Lumpia Shanghai',
    'Caldereta','Beef Caldereta','Bistek','Beef Bistek','Pares','Beef Pares','Tripe and Skin Kare-Kare','Mechado','Beef Mechado','Beef with Stir-Fried Veggies','Burger Steak with Gravy','Burger Steak',
    'Fish Fillet with Tartare Sauce','Fish Fillet with Lemon Butter','Sweet & Sour Fish','Tuna Bicol Express','Garlic Butter Shrimp','Bangus Sisig',
    'Cabbage and Carrot Slaw','Creamy Cucumber','Buttered Veggies','Chopsuey','Buttered Veggies with Toge',
    'Alfredo','Filipino Spaghetti','Aglio Olio','Bam-i','Pancit Bam-i','Silky Sotanghon','Pancit Canton','Bihon Guisado','Palabok',
    'Mango Tapioca','Buko Gulaman','Cathedral Window Jelly','Mini Classic Turon','Maja Blanca with Caramel','Brownies','Cheesy Mamon','Banana Cupcakes','Fruit Salad'];
  prem text[] := array['Pancit Molo','Creamy Chicken Tinola','Cream of Mushroom Soup','Potato Leek Soup','Squash Soup','Cream of Corn Soup','Cream of Asparagus Soup','Carrot and Celery Soup',
    'Kinilaw na Malasugue','Pomelo Salad','Chicken Potato Salad','Chicken Macaroni Salad','Green Salad with Dressing','Tofu Squares','Embutido','Fresh Lumpia','Fried Lumpia','Lumpia Shanghai','Shrimp Potato Salad','Caesar''s Salad','Caesar Salad',
    'Chicken Cordon Bleu','Baked Chicken with Mushrooms','Grilled Chicken with Vegetables','Chicken Parmigiana','Crusty Chicken with Potatoes','Spicy Sweet Chicken Lollies','Chicken Sultanas','Chicken Pandan','Steamed Chicken',
    'Roast Pork','Grilled Spare Ribs','Crispy Pork Kare-Kare','Binagoongan','Grilled Pork Belly',
    'Bakareta','Bakareta con Chorizos','Lengua in Mushroom Sauce','Callos','Beef Pot Roast','Beef Broccoli','Oriental Beef Ribs','Beef Stroganoff','Oxtail Kare-Kare','Beef Mechado','Braised Beef Special','Osso Buco',
    'Fish Fillet with Tartare Sauce','Baked Fish in Herbed Tomatoes','Fish Fillet Sweet and Sour','Pan-Grilled Tuna Steak','Shrimp Tempura','Fish Fillet Parmigiana','Seafood Curry','Rellenong Bangus','Tuna Belly in Olive Oil','Baked Salmon with Garlic Cream',
    'Broccoli with Oyster Sauce','Mixed Vegetables','Four Seasons','Buttered Florets','Seafood Chopsuey with Quail Egg',
    'Silky Sotanghon','Pancit Bam-i','Crispy Canton','Beef Lasagna','Chicken Fettuccine','Baked Macaroni','Tuna and Olive Pasta','Garden Fresh Pasta','Pasta with Three Sauces',
    'Assorted Pastries','Fresh Fruits in Cups','Mango Pandan Salad','Mango Tapioca','Watermelon Balls with Lychee','Coffee Jelly','Crema Española','Leche Flan','Banana Walnut Cupcakes','Lemon or Chocolate Cupcakes'];
  n text; d uuid; s int := 0; p int := 0;
begin
  foreach n in array std loop d := find_dish(n); if d is not null then update dishes set tier = 'standard' where id = d and tier is null; s := s + 1; end if; end loop;
  foreach n in array prem loop d := find_dish(n);
    if d is not null then update dishes set tier = case when tier in ('standard', 'both') then 'both' else 'premium' end where id = d; p := p + 1; end if; end loop;
  raise notice 'Menu tiers set: % standard-list names and % premium-list names matched dishes', s, p;
end $$;
