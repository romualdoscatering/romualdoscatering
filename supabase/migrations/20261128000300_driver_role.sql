-- Driver role, step 1 of 2. Run this on its own first, then 20261128000400_runs_production_approvals.sql.
alter type app_role add value if not exists 'driver';
