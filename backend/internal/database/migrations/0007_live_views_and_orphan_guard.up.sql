-- Make "deleted means gone everywhere" structural rather than a convention.
--
-- Deleting a loan already soft-deletes its collections in one transaction
-- (loan/repository.go SoftDelete), and every current read filters
-- `deleted_at IS NULL`. Both verified working. This migration protects that
-- from FUTURE code, which is where the real risk lies:
--
--   * a report or export written later that queries `collections` directly and
--     forgets the filter would silently read Rs 59,86,100 instead of the true
--     Rs 31,68,020 — the same shape of failure as the dashboard's 500-row cap:
--     a query that looks correct and quietly returns the wrong set;
--   * a new code path that soft-deletes a loan WITHOUT its collections would
--     leave orphan payments propping up the dashboard totals.

-- ---------------------------------------------------------------------------
-- 1. Live views — the filter cannot be forgotten because it is baked in.
--    New reads should target these, not the base tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW collections_live AS
    SELECT c.*
    FROM collections c
    JOIN loans l ON l.id = c.loan_id
    WHERE c.deleted_at IS NULL
      AND l.deleted_at IS NULL;   -- also hides payments under a deleted loan

COMMENT ON VIEW collections_live IS
    'Collections that actually count: not deleted, and whose loan is not deleted. '
    'Query this instead of the collections table for any total, report or export.';

CREATE OR REPLACE VIEW loans_live AS
    SELECT * FROM loans WHERE deleted_at IS NULL;

COMMENT ON VIEW loans_live IS
    'Loans that actually count. Query this instead of the loans table for totals.';

-- ---------------------------------------------------------------------------
-- 2. Orphan guard — deleting a loan ALWAYS takes its collections with it.
--    A backstop, not a replacement: the service already does this atomically.
--    If some future path soft-deletes a loan on its own, this keeps the
--    payments from surviving underneath it and inflating the dashboard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION loans_cascade_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only on the transition to deleted.
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE collections
        SET    deleted_at = NEW.deleted_at,
               updated_at = now()
        WHERE  loan_id = NEW.id
          AND  deleted_at IS NULL;
    END IF;

    -- Un-deleting a loan restores the payments this cascade removed, matched on
    -- the same timestamp so unrelated earlier deletions stay deleted.
    IF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
        UPDATE collections
        SET    deleted_at = NULL,
               updated_at = now()
        WHERE  loan_id = NEW.id
          AND  deleted_at = OLD.deleted_at;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loans_cascade_soft_delete ON loans;
CREATE TRIGGER trg_loans_cascade_soft_delete
    AFTER UPDATE OF deleted_at ON loans
    FOR EACH ROW
    EXECUTE FUNCTION loans_cascade_soft_delete();

COMMENT ON FUNCTION loans_cascade_soft_delete() IS
    'Keeps collections in lock-step with their loan''s deleted state, so a '
    'deleted loan can never leave live payments behind in dashboard totals.';
