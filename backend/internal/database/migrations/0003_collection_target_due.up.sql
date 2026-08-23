-- A collection may carry the schedule slot the collector explicitly chose to
-- pay (the ledger row whose Add button was clicked). Display/attribution only —
-- it is NEVER part of balance math (collected totals stay SUM(amount)).
-- NULL = no explicit target (bulk, clear-overdue, foreclosure, legacy rows):
-- ledger allocation falls back to the receipt-date rule.
-- IF NOT EXISTS: migrations re-run on every boot, and the runner applies them
-- in order. Without the guard, a column created out-of-band (manual hotfix, a
-- restore taken after the DDL but before the schema_migrations insert) makes
-- this file error — which aborts 0004 and 0005 too and stops the server booting.
ALTER TABLE collections ADD COLUMN IF NOT EXISTS target_due_date DATE;
