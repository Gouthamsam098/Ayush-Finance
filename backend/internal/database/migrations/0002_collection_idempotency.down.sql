DROP INDEX IF EXISTS collections_idempotency_key_uniq;
ALTER TABLE collections DROP COLUMN IF EXISTS idempotency_key;
