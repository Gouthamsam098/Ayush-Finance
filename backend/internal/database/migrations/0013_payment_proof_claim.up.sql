-- One payment, one ledger entry: tie a recovery agent's screenshot to its claim.
--
-- A recovery agent's UPI collection is reported twice: the CLAIM (Recovery
-- queue — "customer paid me ₹X") and the SCREENSHOT (Portal proofs — evidence
-- of that same payment). Accepting either one recorded the money, so accepting
-- both put one payment on the ledger twice. Nothing on the server connected
-- them; only a browser-local "acknowledged" flag did.
--
-- The screenshot now points at the claim it proves. From here on:
--   * only the claim records money;
--   * approving the claim accepts its screenshot (as evidence) in the same
--     transaction, rejecting the claim rejects it;
--   * accepting a claim's screenshot directly never posts a collection.

ALTER TABLE payment_proofs ADD COLUMN claim_id BIGINT REFERENCES recovery_submissions(id);
CREATE INDEX idx_payment_proofs_claim ON payment_proofs(claim_id) WHERE claim_id IS NOT NULL;

-- Link screenshots agents uploaded before this change to the claim they were
-- sent with: the same agent's claim on the same loan for the same amount, filed
-- at or before the upload (the latest such claim).
UPDATE payment_proofs p
SET claim_id = (
    SELECT s.id FROM recovery_submissions s
    WHERE s.type = 'COLLECTION_CLAIM' AND s.deleted_at IS NULL
      AND s.loan_id = p.loan_id AND s.agent_user_id = p.submitted_by
      AND s.amount = p.amount AND s.created_at <= p.submitted_at
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT 1)
WHERE p.claim_id IS NULL
  AND p.submitted_by IN (SELECT id FROM users WHERE role = 'RECOVERY_AGENT');

-- Close linked screenshots whose claim was already reviewed, exactly as the new
-- flow does. No collection is written or removed here: an approved claim
-- already recorded its money.
UPDATE payment_proofs p
SET status = 'VERIFIED', reviewed_by = s.reviewed_by, reviewed_at = s.reviewed_at,
    receipt_date = s.receipt_date
FROM recovery_submissions s
WHERE s.id = p.claim_id AND p.status = 'PENDING' AND p.deleted_at IS NULL
  AND s.status = 'APPROVED';

UPDATE payment_proofs p
SET status = 'REJECTED', reviewed_by = s.reviewed_by, reviewed_at = s.reviewed_at
FROM recovery_submissions s
WHERE s.id = p.claim_id AND p.status = 'PENDING' AND p.deleted_at IS NULL
  AND s.status = 'REJECTED';
