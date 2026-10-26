-- Screenshots closed by the backfill keep their reviewed status.
DROP INDEX IF EXISTS idx_payment_proofs_claim;
ALTER TABLE payment_proofs DROP COLUMN IF EXISTS claim_id;
