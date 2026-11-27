-- Roles, step 1 of 2: three new roles. Run this first, on its own, then run step 2.
--   event_specialist  (Catering) bookings, events and inquiries
--   head_chef         recipes and costing
--   rnd_chef          R&D chef: recipes and costing only
alter type app_role add value if not exists 'event_specialist';
alter type app_role add value if not exists 'head_chef';
alter type app_role add value if not exists 'rnd_chef';
