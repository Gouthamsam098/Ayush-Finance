-- Idempotency for payment recording.
--
-- Problem: POST /collections had no dedup. If the network times out after the
-- INSERT commits but before the response reaches the client, the client's retry
-- creates a SECOND real payment — two receipts for one payment, an inflated
-- collected total, and profit-by-month overstated. The receipt_no unique
-- constraint does not help: it is minted server-side from a sequence, so every
-- retry gets a fresh number.
--
-- Fix: the client sends an Idempotency-Key with each payment write. The first
-- request stores it; a retry carrying the same key hits this unique index and
-- the server returns the ORIGINAL payment instead of inserting again.
--
-- Nullable + partial unique index, so:
--   * existing rows (and any client that omits the header) are unaffected;
--   * uniqueness is scoped per loan, so two different loans can never collide
--     even if a client reuses a key.
ALTER TABLE collections
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS collections_idempotency_key_uniq
    ON collections (loan_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN collections.idempotency_key IS
    'Client-supplied Idempotency-Key for the payment write. Unique per loan; a '
    'retry with the same key returns the original row instead of duplicating '
    'the payment.';
