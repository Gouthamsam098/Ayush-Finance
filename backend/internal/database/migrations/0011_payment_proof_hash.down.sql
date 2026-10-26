DROP INDEX IF EXISTS idx_payment_proofs_loan_hash;
ALTER TABLE payment_proofs DROP COLUMN IF EXISTS content_sha256;
