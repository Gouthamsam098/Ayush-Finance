-- One open promise to pay per loan.
--
-- Problem: POST /agent/promises always inserted, so promising again on a loan
-- (a new date, or a double tap) left several OPEN promises for the same loan,
-- each shown as a separate promise on the agent and staff screens.
--
-- Fix: saving a promise on a loan that already has an open one now updates that
-- promise (recovery.Repository.SaveOpenPromise). Here, the duplicates already
-- stored are closed: the newest open promise per loan stays open, older ones
-- become CANCELLED with a note (kept, not deleted). Then a partial unique index
-- makes a second open promise per loan impossible, as
-- idx_recovery_one_pending_claim does for claims.
UPDATE recovery_submissions s
SET status = 'CANCELLED', reviewed_at = now(), updated_at = now(),
    review_note = 'Replaced by a newer promise on this loan'
WHERE s.type = 'PROMISE_TO_PAY' AND s.status = 'OPEN' AND s.deleted_at IS NULL
  AND EXISTS (
      SELECT 1 FROM recovery_submissions n
      WHERE n.loan_id = s.loan_id AND n.type = 'PROMISE_TO_PAY' AND n.status = 'OPEN'
        AND n.deleted_at IS NULL AND (n.created_at, n.id) > (s.created_at, s.id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_one_open_promise
    ON recovery_submissions(loan_id)
    WHERE type = 'PROMISE_TO_PAY' AND status = 'OPEN' AND deleted_at IS NULL;
