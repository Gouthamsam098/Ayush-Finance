-- SHA-256 of each payment-proof screenshot, so a copy of a proof that is
-- already PENDING or VERIFIED on the same loan can be refused cheaply.
--
-- Without it the same screenshot could be submitted twice (a retry after a
-- dropped connection, a second device, "did it go through?"), and accepting
-- both recorded one payment twice. See paymentproof Repository.Create, which
-- locks the loan row so the check cannot be raced.
--
-- Deliberately NOT a unique index: existing data may already hold such
-- copies, and a unique constraint would fail this migration on them.
ALTER TABLE payment_proofs ADD COLUMN content_sha256 BYTEA;

UPDATE payment_proofs SET content_sha256 = sha256(content) WHERE content_sha256 IS NULL;

CREATE INDEX idx_payment_proofs_loan_hash ON payment_proofs(loan_id, content_sha256)
    WHERE deleted_at IS NULL;
