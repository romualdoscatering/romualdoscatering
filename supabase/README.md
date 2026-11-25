# Romualdo's Platform — database (Supabase)

One database, one login, two workspaces (**restaurant**, **catering**). This folder is the whole backend:
tables, security rules and the workflow functions that run purchasing, receiving, stock and costing.
The current `/ops` app keeps running until each part is replaced.

## Files

| File | What it holds |
| --- | --- |
| `migrations/…0100_foundation.sql` | People, workspaces, roles, role checks, audit log, document numbers (PR-2026-0001…) |
| `migrations/…0200_inventory.sql` | Items, suppliers, par levels, the stock ledger (`stock_moves`), counts, stock-out (issue, waste, transfer) |
| `migrations/…0300_menu_recipes.sql` | Standard dishes + other spellings, recipes per batch (verified by a chef), buffet course shares, packed-meal sets |
| `migrations/…0400_catering.sql` | Clients, website bookings, events, menus, stock set aside per event, what an event needs (`event_requirements`), menu text matching |
| `migrations/…0500_purchasing.sql` | Requests → approval → orders → receiving; automatic requests from events (`generate_event_pr`) and par levels; issue to event; costing; cash advances |
| `migrations/…0600_restaurant_hr.sql` | Daily sales, kitchen dish counts, food cost view, HR hooks |
| `migrations/…0700_security.sql` | Row-level security on every table, audit triggers, function access |
| `migrations/…0800_app_helpers.sql` | People & roles for the owner, list views for the staff app |
| `migrations/…0900_tray_size.sql` | A tray serves 10–12 guests (planned at 10) |
| `migrations/…1000_website_bookings.sql` | Website inquiries → bookings; one tap makes the event |
| `migrations/…1100_restaurant_kitchen.sql` | Restaurant menu, daily kitchen stock sheet |
| `migrations/…1200_pos.sql` | Order-taking POS, cash drawer shifts, daily POS summary |
| `migrations/20261125000100_billing.sql` | Statements of account per event, payments (void only), payment status for everyone in catering |
| `seed.sql` | Buffet course shares |
| `../tools/import_ops_export.py` | Moves events and menus from the current "Romualdo's Ops Data" sheet |
| `../test/` | Local test: a stand-in for Supabase's auth plus an end-to-end scenario (21 checks) |

**Not in this public repo:** `private_seed.sql` (items, the standard dish list with booking counts, draft recipes).
It is kept privately and loaded after the migrations.

## Set up

1. Create a Supabase project (Singapore region).
2. SQL editor: run `migrations/*.sql` in order, then `seed.sql`, then `private_seed.sql`.
3. Authentication: turn off public sign-ups; add each person, then a row in `profiles` and their `memberships`.
4. Optional: `python3 tools/import_ops_export.py "<Ops Data export>.csv" > import_events.sql`, run it in the SQL editor
   (it contains client details — never commit the output).

## Test locally

Needs PostgreSQL 16:

```
createdb rom
psql -d rom -f test/00_supabase_stub.sql
for f in supabase/migrations/*.sql supabase/seed.sql private_seed.sql; do psql -d rom -v ON_ERROR_STOP=1 -f $f; done
bash test/run.sh
```
