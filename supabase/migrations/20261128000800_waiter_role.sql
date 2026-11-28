-- Run this one alone first: adds the Waiter role (view-only service staff).
alter type app_role add value if not exists 'waiter';
