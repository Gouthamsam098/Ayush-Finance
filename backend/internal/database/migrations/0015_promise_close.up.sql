-- Promises to pay can be closed on the server.
--
-- An agent marks a promise FULFILLED (the customer paid as promised) or
-- CANCELLED. Until now that lived only in the agent's browser, so every other
-- device still showed the promise as open. Closing stamps reviewed_at (when it
-- was closed) and reviewed_by (who closed it), like reviewing a claim.
--
-- The review-stamp rule now covers both kinds: an open item (PENDING claim /
-- OPEN promise) has no reviewed_at, a settled one always has it.

-- Nothing could close a promise before, but stamp any closed row defensively
-- so the new rule holds for every existing row.
UPDATE recovery_submissions
SET reviewed_at = updated_at
WHERE type = 'PROMISE_TO_PAY' AND status IN ('FULFILLED', 'CANCELLED') AND reviewed_at IS NULL;

ALTER TABLE recovery_submissions DROP CONSTRAINT recovery_submissions_review_stamped;
ALTER TABLE recovery_submissions ADD CONSTRAINT recovery_submissions_review_stamped
    CHECK ((status IN ('PENDING', 'OPEN')) = (reviewed_at IS NULL));
