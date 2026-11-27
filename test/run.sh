#!/bin/bash
# End-to-end scenario test. as <user> "<sql>" runs SQL as that logged-in user under row-level security.
export PGHOST=/tmp PGPORT=5433 PGUSER=postgres
DB=rom
declare -A U=([owner]=00000000-0000-0000-0000-000000000001 [coord]=00000000-0000-0000-0000-000000000002 [chef]=00000000-0000-0000-0000-000000000003 \
              [buyer]=00000000-0000-0000-0000-000000000004 [store]=00000000-0000-0000-0000-000000000005 [mgr]=00000000-0000-0000-0000-000000000006 [staff1]=00000000-0000-0000-0000-000000000007)
as() { psql -d $DB -qAt -v ON_ERROR_STOP=1 -c "set role authenticated; set request.jwt.claim.sub='${U[$1]}'; $2" 2>&1; }
anon() { psql -d $DB -qAt -c "set role anon; $1" 2>&1; }
su_() { psql -d $DB -qAt -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
expect_fail() { out=$(as "$1" "$2"); if echo "$out" | grep -qi "error" || [ -z "$out" ]; then [ -z "$out" ] && { echo "  ✓ blocked: 0 rows changed (not permitted)"; return; }; echo "  ✓ blocked: $(echo "$out" | grep -i error | head -1 | sed 's/.*ERROR: *//' | cut -c1-90)"; else echo "  ✗ NOT BLOCKED: $out"; fi; }
echo "== people & roles"
for n in "${!U[@]}"; do su_ "insert into auth.users(id) values ('${U[$n]}')"; done
su_ "insert into profiles(id, username, full_name, is_admin) values ('${U[owner]}','owner','Owner',true),('${U[coord]}','coord','Coordinator',false),('${U[chef]}','chef','Chef',false),('${U[buyer]}','buyer','Buyer',false),('${U[store]}','store','Storekeeper',false),('${U[mgr]}','mgr','Manager',false),('${U[staff1]}','staff1','Restaurant staff',false)"
su_ "insert into memberships values ('${U[coord]}','catering','coordinator'),('${U[coord]}','catering','event_specialist'),('${U[chef]}','catering','chef'),('${U[chef]}','catering','head_chef'),('${U[chef]}','restaurant','chef'),('${U[store]}','restaurant','storekeeper'),('${U[buyer]}','catering','purchaser'),('${U[buyer]}','restaurant','purchaser'),('${U[store]}','catering','storekeeper'),('${U[mgr]}','catering','manager'),('${U[mgr]}','restaurant','manager'),('${U[staff1]}','restaurant','staff')"
echo "== opening stock: catering store already has 2 L soy sauce and 10 kg rice"
CNT=$(as store "insert into stock_counts(ws) values ('catering') returning id" | tail -1)
as store "insert into stock_count_lines(count_id,item_id,counted) select '$CNT', id, case name when 'Soy sauce' then 2 else 10 end from items where name in ('Soy sauce','Rice')" >/dev/null
as store "select post_count('$CNT')"
echo "== coordinator books a 100-guest customized buffet"
EV=$(as coord "insert into events(kind,title,event_type,event_date,pax,contract_price,status) values ('buffet','Santos Wedding','Wedding',current_date+10,100,85000,'confirmed') returning id" | tail -1)
as coord "insert into event_menu(event_id,course,dish_id) select '$EV', c, find_dish(d) from (values ('Main','Chicken Teriyaki'),('Main','beef steak'),('Pasta / noodles','Silky Sotanghon'),('Rice','Plain Rice'),('Drinks','Assorted Soft Drinks'),('Dessert','Buko Pandan')) v(c,d); insert into event_menu(event_id,course,custom_name) values ('$EV','Soup','Kimchi Sinigang sa Watermelon')" >/dev/null
echo "  'beef steak' resolved to: $(as coord "select d.name from event_menu m join dishes d on d.id=m.dish_id where m.event_id='$EV' and m.course='Main' order by d.name limit 1 offset 0")"
echo "== auto-generate the purchase request while recipes are still DRAFT"
as coord "select generate_event_pr('$EV')"
echo "== chef verifies the recipes; coordinator tries to verify (should fail)"
expect_fail coord "select verify_recipe(find_dish('Chicken Teriyaki'))"
as chef "select verify_recipe(id) from dishes where id in (select dish_id from recipes)" >/dev/null && echo "  ✓ chef verified $(as chef "select count(*) from recipes where status='verified'") recipes"
echo "== auto-generate again"
PR=$(as coord "select generate_event_pr('$EV')"); echo "  $PR" | cut -c1-260
PRID=$(as coord "select id from purchase_requests where event_id='$EV'")
as coord "select '  ' || rpad(i.name,24) || lpad(l.qty::text,9) || ' ' || i.stock_unit || '   in store ' || l.on_hand_then from pr_lines l join items i on i.id=l.item_id where pr_id='$PRID' order by i.name" | head -40
echo "  estimated total: $(as coord "select sum(qty*est_unit_cost) from pr_lines where pr_id='$PRID'") (only items with a last price)"
echo "== guest count goes 100 → 120 and runs again: request only grows for the difference"
as coord "update events set pax=120 where id='$EV'" ; as coord "select generate_event_pr('$EV')" | cut -c1-120
echo "  chicken thigh now: $(as coord "select qty from pr_lines l join items i on i.id=l.item_id where pr_id='$PRID' and i.name='Chicken thigh fillet'") kg (100 pax: 0.6×100/12×2.0=10 kg → 120 pax: 12 kg)"
echo "== submit; coordinator cannot approve; manager approves and trims soft drinks to 150"
as coord "select submit_pr('$PRID')" >/dev/null
expect_fail coord "select decide_pr('$PRID', true)"
expect_fail buyer "update purchase_requests set status='approved' where id='$PRID' returning id"
SD=$(as mgr "select l.id from pr_lines l join items i on i.id=l.item_id where pr_id='$PRID' and i.name like 'Soft drinks%'")
as mgr "select decide_pr('$PRID', true, 'ok, fewer drinks', '{\"$SD\": 150}')" >/dev/null && echo "  ✓ approved: $(as mgr "select status from purchase_requests where id='$PRID'")"
echo "== buyer gets a cash advance, orders chicken+beef at the market; storekeeper receives (chicken 0.5 kg short, beef price higher)"
ADV=$(su_ "set role authenticated; set request.jwt.claim.sub='${U[mgr]}'; insert into cash_advances(ws,event_id,given_to,amount) values ('catering','$EV','${U[buyer]}',8000) returning id" | tail -1)
LINES=$(as buyer "select array_agg(l.id)::text from pr_lines l join items i on i.id=l.item_id where pr_id='$PRID' and i.name in ('Chicken thigh fillet','Beef sirloin')")
PO=$(as buyer "select create_po('$PRID', null, 'Agdao market', null, '$LINES'::uuid[], '$ADV')"); echo "  order $PO"
POID=$(as buyer "select id from purchase_orders where po_no='$PO'")
RL=$(as store "select json_agg(json_build_object('po_line_id',pl.id,'qty',case when i.name like 'Chicken%' then pl.qty-0.5 else pl.qty end,'unit_cost',case when i.name like 'Chicken%' then 230 else 520 end)) from po_lines pl join items i on i.id=pl.item_id where po_id='$POID'")
as store "select receive_po('$POID', '$RL'::jsonb, 'OR-1234')"
echo "  catering stock now: $(as store "select string_agg(name||' '||on_hand,', ') from stock_on_hand where ws='catering'")"
echo "  last price beef sirloin: $(as store "select last_cost from items where name='Beef sirloin'")"
echo "== the same items cannot be ordered twice from this request"
expect_fail buyer "select create_po('$PRID', null, 'Agdao market', null, '$LINES'::uuid[])"
echo "== prep day: issue to event; leftovers returned; costing"
IL=$(as store "select json_agg(json_build_object('item_id',item_id,'qty',reserved)) from event_pick_list where event_id='$EV'")
as store "select issue_to_event('$EV', '$IL'::jsonb, 'Chef')" >/dev/null
as store "select issue_to_event('$EV', (select json_agg(json_build_object('item_id',id,'qty',1))::jsonb from items where name='Beef sirloin'), 'Chef', true)" >/dev/null
as coord "select '  costing: contract '||contract_price||' · ingredients used '||ingredients_used||' · status '||(select status from events where id='$EV') from event_costing where event_id='$EV'"

echo "== liquidation: advance 10000; change returned is 2 pesos short"
su_ "update cash_advances set amount=10000 where id='$ADV'" >/dev/null
expect_fail mgr "select liquidate_advance('$ADV', -5)"
as mgr "select liquidate_advance('$ADV', 10000-(select sum(qty_received*unit_cost) from receipt_lines)-2)" 2>&1 | grep -o 'Does not balance.*' | head -1 | sed 's/^/  ✓ refused: /'
as mgr "select liquidate_advance('$ADV', 10000-(select sum(qty_received*unit_cost) from receipt_lines)-2, 'buyer paid 2 for plastic bags')"
echo "== pre-packaged orders: 3 trays of Chicken Teriyaki, and 25 packed lunches"
EV2=$(as coord "insert into events(kind,title,event_date,status) values ('trays','Tray order',current_date+3,'confirmed') returning id" | tail -1)
as coord "insert into event_menu(event_id,course,dish_id,qty) values ('$EV2','Main',find_dish('Chicken Teriyaki'),3)" >/dev/null
as coord "select item||' '||needed||' '||unit||' (free in store '||free_stock||', to buy '||to_buy||')' from event_requirements('$EV2') where item in ('Chicken thigh fillet','Soy sauce')" | sed 's/^/  trays: /'
PK=$(as coord "insert into pack_sets(name,price) values ('Packed Lunch A',170) returning id" | tail -1)
as coord "insert into pack_components select '$PK', find_dish(d), 1 from unnest(array['Chicken Teriyaki','Plain Rice','Lumpiang Shanghai']) d" >/dev/null
EV3=$(as coord "insert into events(kind,title,event_date,status,pax) values ('packs','Office lunch',current_date+4,'confirmed',25) returning id" | tail -1)
as coord "insert into event_menu(event_id,course,pack_id,qty) values ('$EV3','Main','$PK',25)" >/dev/null
as coord "select item||' '||needed||' '||unit from event_requirements('$EV3') where item in ('Chicken thigh fillet','Rice','Ground pork')" | sed 's/^/  packs: /'
echo "== workspace separation and direct-edit protection"
echo "  restaurant staff sees catering events: $(as staff1 "select count(*) from events") · catering requests: $(as staff1 "select count(*) from purchase_requests where ws = 'catering'") · catering stock rows: $(as staff1 "select count(*) from stock_moves")"
expect_fail staff1 "insert into stock_moves(ws,item_id,kind,qty) select 'restaurant', id, 'receipt', 5 from items limit 1"
expect_fail coord "insert into stock_moves(ws,item_id,kind,qty) select 'catering', id, 'count_adjust', 50 from items limit 1"
expect_fail staff1 "select generate_event_pr('$EV')"
expect_fail buyer "update items set last_cost=1 where name='Beef sirloin' returning id"
echo "  staff1 edits rows of a catering PR → rows changed: $(as staff1 "update pr_lines set qty=1 returning 1" | grep -c 1)"
echo "== restaurant: par restock; waste needs a reason"
as mgr "insert into item_par select id,'restaurant',5,8 from items where name in ('Pork liempo','Cooking oil')" >/dev/null
as mgr "select generate_par_pr('restaurant')" | cut -c1-80
expect_fail staff1 "select post_stock_out('restaurant','waste',(select json_agg(json_build_object('item_id',id,'qty',1))::jsonb from items where name='Cabbage'))"
echo "== website booking as an anonymous visitor"
echo "  submitted: $(anon "select submit_booking('{\"customer\":{\"name\":\"Test\",\"phone\":\"0917\"},\"event\":{\"pax\":\"80\",\"date\":\"2026-12-30\"}}')")"
out=$(anon "select count(*) from bookings"); echo "$out" | grep -q "permission denied" && echo "  ✓ blocked: visitor cannot read bookings or any table" || echo "  ✗ visitor read bookings: $out"
echo "== audit trail entries: $(su_ "select count(*) from audit_log") · who approved $(su_ "select pr_no from purchase_requests where id='$PRID'"): $(su_ "select p.full_name from purchase_requests r join profiles p on p.id=r.approved_by where r.id='$PRID'")"
echo "== recipe control: a manager's edit sends a verified recipe back to draft; coordinators can't edit; nobody fakes verification"
as mgr "update recipe_lines set qty=3 where dish_id=find_dish('Chicken Teriyaki') and item_id=(select id from items where name='Chicken thigh fillet')" >/dev/null
[ "$(as mgr "select status from recipes where dish_id=find_dish('Chicken Teriyaki')")" = "draft" ] && echo "  ✓ blocked: manager edit → back to draft" || echo "  ✗ manager edit kept it verified"
expect_fail coord "update recipe_lines set qty=9 where dish_id=find_dish('Chicken Teriyaki') returning 1"
expect_fail mgr "update recipes set status='verified', verified_by='${U[chef]}' where dish_id=find_dish('Plain Rice') returning 1"
echo "== billing: managers bill and record payments; coordinators see nothing"
as mgr "insert into event_bills(event_id) values ('$EV2')" >/dev/null
as mgr "insert into bill_lines(event_id,label,rate,qty,unit) values ('$EV2','Chicken Teriyaki',1500,3,'tray')" >/dev/null
as mgr "insert into event_payments(event_id,amount,method,ref) values ('$EV2',2000,'gcash','GC1')" >/dev/null
echo "  manager sees: $(as mgr "select soa_no||' total '||total||' paid '||paid||' balance '||balance||' '||status from event_money(array['$EV2'::uuid])")"
echo "  coordinator rows from event_money: $(as coord "select count(*) from event_money(array['$EV2'::uuid])")"
expect_fail coord "insert into event_payments(event_id,amount) values ('$EV2',100) returning 1"
[ "$(as coord "select count(*) from event_payments")" = "0" ] && echo "  ✓ blocked: coordinator cannot read payments" || echo "  ✗ coordinator read payments"
expect_fail mgr "update event_payments set amount=1 returning 1"
expect_fail mgr "delete from event_payments returning 1"
echo "== money is hidden from people who only encode events"
as mgr "update events set contract_price = 30000 where id = '$EV2'" >/dev/null
echo "  manager: contract $(as mgr "select contract_price from event_finance where event_id='$EV2'") · events.contract_price now '$(as mgr "select contract_price from events where id='$EV2'")'"
[ "$(as coord "select count(*) from event_finance")" = "0" ] && echo "  ✓ blocked: coordinator cannot read contract prices" || echo "  ✗ coordinator read contract prices"
[ "$(as coord "select count(*) from event_money(array['$EV2'::uuid])")" = "0" ] && echo "  ✓ blocked: coordinator gets no payment status" || echo "  ✗ coordinator got payment status"
[ -z "$(as coord "select total_cost from event_costing where event_id='$EV2'")" ] && echo "  ✓ blocked: coordinator sees no costing amounts" || echo "  ✗ coordinator saw costing"
expect_fail coord "update events set contract_price = 1 where id = '$EV2' returning 1"
