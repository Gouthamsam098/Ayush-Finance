DROP INDEX IF EXISTS investor_payouts_idempotency_key_uniq;
ALTER TABLE investor_payouts DROP COLUMN IF EXISTS idempotency_key;
