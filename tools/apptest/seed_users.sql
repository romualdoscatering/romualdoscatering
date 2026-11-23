-- test people (local only)
insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','owner@test.ph'), ('00000000-0000-0000-0000-0000000000a2','coord@staff.romualdos.ph'),
 ('00000000-0000-0000-0000-0000000000a3','chef@staff.romualdos.ph'), ('00000000-0000-0000-0000-0000000000a4','buyer@staff.romualdos.ph'),
 ('00000000-0000-0000-0000-0000000000a5','store@staff.romualdos.ph'), ('00000000-0000-0000-0000-0000000000a6','mgr@staff.romualdos.ph'),
 ('00000000-0000-0000-0000-0000000000a7','resto@staff.romualdos.ph'), ('00000000-0000-0000-0000-0000000000a8','newbie@staff.romualdos.ph');
insert into profiles(id, username, full_name, is_admin) values
 ('00000000-0000-0000-0000-0000000000a1','owner','Owner Romualdo',true), ('00000000-0000-0000-0000-0000000000a2','coord','Cora Coordinator',false),
 ('00000000-0000-0000-0000-0000000000a3','chef','Carlo Chef',false), ('00000000-0000-0000-0000-0000000000a4','buyer','Bea Buyer',false),
 ('00000000-0000-0000-0000-0000000000a5','store','Sam Storekeeper',false), ('00000000-0000-0000-0000-0000000000a6','mgr','Mona Manager',false),
 ('00000000-0000-0000-0000-0000000000a7','resto','Rey Restaurant',false);
insert into memberships values ('00000000-0000-0000-0000-0000000000a2','catering','coordinator'),('00000000-0000-0000-0000-0000000000a3','catering','chef'),
 ('00000000-0000-0000-0000-0000000000a4','catering','purchaser'),('00000000-0000-0000-0000-0000000000a5','catering','storekeeper'),
 ('00000000-0000-0000-0000-0000000000a6','catering','manager'),('00000000-0000-0000-0000-0000000000a7','restaurant','staff');
