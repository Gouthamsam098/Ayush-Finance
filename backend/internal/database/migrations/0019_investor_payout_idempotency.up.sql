-- Idempotency for investor interest payouts (same contract as collections, 0002).
--
-- Problem: POST /investments/{id}/payouts had no dedup. If the response was lost
-- after the payout and its expense committed, pressing Pay again recorded the
-- interest a second time (a second expense too), within the payout ceiling.
--
-- Fix: the client sends an Idempotency-Key; a retry with the same key returns
-- the original payout instead of paying again. Nullable + partial unique index,
-- scoped per investment, so existing rows and keyless callers are unaffected.
ALTER TABLE investor_payouts
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS investor_payouts_idempotency_key_uniq
    ON investor_payouts (investment_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
