-- Service / waiter role, step 1 of 2: the new role name. Run this first, on its own, then run step 2.
--   service   in-house waiters and service staff: see events, reservations and the 86 / running-low list, view only
alter type app_role add value if not exists 'service';
