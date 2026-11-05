-- Closed promises keep their status; the old rule cannot hold for them, so they
-- are reopened to OPEN before it is restored.
UPDATE recovery_submissions SET status = 'OPEN', reviewed_at = NULL, reviewed_by = NULL
WHERE type = 'PROMISE_TO_PAY' AND status IN ('FULFILLED', 'CANCELLED');

ALTER TABLE recovery_submissions DROP CONSTRAINT recovery_submissions_review_stamped;
ALTER TABLE recovery_submissions ADD CONSTRAINT recovery_submissions_review_stamped
    CHECK ((status IN ('APPROVED', 'REJECTED')) = (reviewed_at IS NOT NULL));
