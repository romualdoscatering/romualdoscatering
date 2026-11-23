-- Public seed: buffet course rules only (editable later in the app).
-- Items, the standard dish list and recipes are business data: load private_seed.sql (kept out of the public repo).
begin;
insert into course_rules(course, share, note) values ('Soup', 1.0, 'one cup each') on conflict (course) do nothing;
insert into course_rules(course, share, note) values ('Salad / appetizer', 0.8, '') on conflict (course) do nothing;
insert into course_rules(course, share, note) values ('Main', 0.6, 'several mains on the table: each eaten by ~60% of guests') on conflict (course) do nothing;
insert into course_rules(course, share, note) values ('Pasta / noodles', 0.7, '') on conflict (course) do nothing;
insert into course_rules(course, share, note) values ('Vegetables', 0.6, '') on conflict (course) do nothing;
insert into course_rules(course, share, note) values ('Rice', 1.0, 'rice recipe is per guest') on conflict (course) do nothing;
insert into course_rules(course, share, note) values ('Dessert', 0.8, '') on conflict (course) do nothing;
insert into course_rules(course, share, note) values ('Drinks', 1.5, 'about 1.5 drinks per guest') on conflict (course) do nothing;
insert into course_rules(course, share, note) values ('Station', 1.0, '') on conflict (course) do nothing;
commit;
