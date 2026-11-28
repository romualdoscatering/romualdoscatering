#!/bin/bash
# Service / waiter role: sees events, reservations and the 86 list, view only, and nothing else.
# Run after the migrations (same local database as run.sh): bash test/service_role.sh
export PGHOST=/tmp PGPORT=5433 PGUSER=postgres
DB=rom
declare -A U=([owner]=00000000-0000-0000-0000-0000000000a1 [mgr]=00000000-0000-0000-0000-0000000000a2 [staff]=00000000-0000-0000-0000-0000000000a3
              [waiter]=00000000-0000-0000-0000-0000000000a4 [both]=00000000-0000-0000-0000-0000000000a5 [coord]=00000000-0000-0000-0000-0000000000a6)
as() { psql -d $DB -qAt -v ON_ERROR_STOP=1 -c "set role authenticated; set request.jwt.claim.sub='${U[$1]}'; $2" 2>&1; }
su_() { psql -d $DB -qAt -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
PASS=0; FAIL=0
ok() { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
check() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', expected '$3')"; }
none() { out=$(as "$1" "$2"); if [ "$out" = "0" ] || [ -z "$out" ] || echo "$out" | grep -qi "error"; then ok "$3"; else bad "$3 (got '$out')"; fi; }
blocked() { out=$(as "$1" "$2"); if echo "$out" | grep -qi "error" || [ -z "$out" ]; then ok "$3"; else bad "$3 (got '$out')"; fi; }

echo "== people"
for n in "${!U[@]}"; do su_ "insert into auth.users(id, email) values ('${U[$n]}', '$n@test') on conflict do nothing" >/dev/null; done
su_ "insert into profiles(id, username, full_name, is_admin) values ('${U[owner]}','owner_s','Owner',true),('${U[mgr]}','mgr_s','Resto Manager',false),('${U[staff]}','staff_s','Resto Staff',false),('${U[waiter]}','waiter_s','Waiter Only',false),('${U[both]}','both_s','Waiter and Staff',false),('${U[coord]}','coord_s','Coordinator',false) on conflict do nothing" >/dev/null
su_ "insert into memberships values ('${U[mgr]}','restaurant','manager'),('${U[staff]}','restaurant','staff'),('${U[waiter]}','restaurant','service'),('${U[both]}','restaurant','service'),('${U[both]}','restaurant','staff'),('${U[coord]}','catering','coordinator') on conflict do nothing" >/dev/null

echo "== test data: a menu dish that is out, a website booking, a catering event, a table reservation, sales"
su_ "delete from table_reservations; delete from bookings where event_id is null" >/dev/null   # start clean so the test can run again
D=$(su_ "insert into dishes(name, category) values ('Test Kare-Kare','Beef') on conflict do nothing returning id" | tail -1)
[ -z "$D" ] && D=$(su_ "select id from dishes where name='Test Kare-Kare'")
su_ "insert into restaurant_menu(dish_id, section, min_level) values ('$D','Mains',5) on conflict do nothing" >/dev/null
su_ "insert into dish_day_counts(dish_id, count_date, beginning, produced, pulled_out, sold, ending) values ('$D', current_date, 4, 0, 0, 4, 0) on conflict do nothing" >/dev/null 2>&1
su_ "insert into kitchen_days(count_date, saved_by) values (current_date, '${U[mgr]}') on conflict do nothing" >/dev/null
psql -d $DB -qAt -c "set role anon; select submit_booking('{\"customer\":{\"name\":\"Dela Cruz Family\",\"phone\":\"09171234567\",\"email\":\"dc@example.com\"},\"event\":{\"pax\":\"60\",\"date\":\"$(date -d '+3 day' +%F)\",\"type\":\"Birthday\"}}')" >/dev/null
su_ "insert into events(kind, title, event_type, event_date, pax, status) values ('buffet','Santos Wedding','Wedding',current_date+1,100,'confirmed')" >/dev/null
check "manager adds a table reservation" "$(as mgr "insert into table_reservations(res_date, res_time, guest_name, phone, pax, table_label, occasion) values (current_date, '19:00', 'Reyes', '09998887777', 6, 'T4', 'Anniversary') returning 'ok'" | tail -1)" "ok"
check "the reservation is stamped with who took it" "$(su_ "select p.full_name from table_reservations r join profiles p on p.id = r.created_by where guest_name='Reyes'")" "Resto Manager"

echo "== waiter: what they CAN see"
R=$(as waiter "select reservations_board(current_date, current_date + 30)")
check "sees today's table reservation" "$(echo "$R" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["tables"]))')" "1"
check "no guest phone number for waiters" "$(echo "$R" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["tables"][0]["phone"])')" "None"
check "sees the catering booking from the website" "$(echo "$R" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["catering"]))')" "1"
check "catering booking has no phone, email or estimate" "$(echo "$R" | python3 -c 'import json,sys; d=json.load(sys.stdin); c=d["catering"][0]; print(any(k in c for k in ("phone","email","payload","estimate")))')" "False"
check "sees the 86 list (the dish that is out)" "$(as waiter "select board_86(current_date)" | python3 -c 'import json,sys; d=json.load(sys.stdin); print([r["name"] for r in d["rows"] if float(r["ending"])<=0])')" "['Test Kare-Kare']"
check "sees the events board" "$(as waiter "select jsonb_array_length(events_board(current_date, current_date + 30)) > 0")" "t"

echo "== waiter: what they can NOT see (sales, POS, purchasing, stock, costing, recipes, clients)"
for t in daily_sales pos_orders pos_lines pos_shifts purchase_requests pr_lines purchase_orders cash_advances expenses stock_moves stock_counts item_par \
         restaurant_menu dish_day_counts kitchen_days table_reservations bookings clients events event_menu event_finance items suppliers dishes recipes recipe_lines pack_sets audit_log; do
  none waiter "select count(*) from $t" "no rows from $t"
done
none waiter "select count(*) from kitchen_sheet(current_date)" "kitchen counts sheet gives nothing directly"

echo "== waiter: can't change anything"
blocked waiter "insert into table_reservations(res_date, guest_name) values (current_date, 'Walk-in') returning 1" "can't add a reservation"
blocked waiter "update table_reservations set status='seated' returning 1" "can't change a reservation"
blocked waiter "insert into dish_day_counts(dish_id, count_date, ending) values ('$D', current_date + 1, 9) returning 1" "can't change the 86 count"
blocked waiter "select pos_save('{}'::jsonb)" "can't use the POS"
blocked waiter "select create_event_from_booking((select id from bookings limit 1))" "can't turn a booking into an event"

echo "== the rest of the team is unchanged"
check "restaurant staff still sees the 86 sheet" "$(as staff "select count(*) > 0 from kitchen_sheet(current_date)")" "t"
check "restaurant staff sees reservations with phone" "$(as staff "select reservations_board(current_date, current_date + 30) #>> '{tables,0,phone}'")" "09998887777"
blocked staff "insert into table_reservations(res_date, guest_name) values (current_date, 'X') returning 1" "restaurant staff can't add reservations (managers only)"
check "restaurant staff still reads dishes" "$(as staff "select count(*) > 0 from dishes")" "t"
check "waiter + staff keeps the staff access" "$(as both "select count(*) > 0 from kitchen_sheet(current_date)")" "t"
check "coordinator still reads catering bookings" "$(as coord "select count(*) > 0 from bookings")" "t"
none coord "select count(*) from table_reservations" "catering-only people don't read table reservations directly"
check "owner sees everything" "$(as owner "select count(*) from table_reservations")" "1"

echo
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
