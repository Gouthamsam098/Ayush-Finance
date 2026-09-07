-- Prevent a schedule slot from being paid MORE than it is owed.
--
-- INCIDENT (Sept 2026): a collection session was entered a second time two days
-- later — 388 receipts in 23 minutes across 19 loans, Rs 11,90,080 of money that
-- was never collected. Seven loans auto-closed on the phantom money and stopped
-- being collected from.
--
-- Why the existing guards did not catch it:
--   * idempotency_key    — unique per (loan, key), but each re-key carried its
--                          OWN valid key: they were separate deliberate writes,
--                          not a network retry.
--   * overpayment ceiling— only fires once cumulative collections exceed the
--                          principal. Measured against the real incident it
--                          would have blocked 0 of 19 loans; every rupee of the
--                          Rs 11,90,080 still went through.
--   * UI confirmation    — advisory, and a user can click past it.
--
-- Why NOT a plain UNIQUE(loan_id, target_due_date):
--   a PARTIAL payment is topped up with a SECOND receipt against the same slot
--   (documented flow, COLLECTION_LEDGER_BASELINE matrix #3). A unique index
--   would reject that legitimate money. The rule is not "one row per slot" —
--   it is "a slot may not be funded beyond what it is owed".
--
-- This trigger enforces exactly that, in the database, where no client can
-- bypass it. Amounts are whole rupees (BIGINT), so the comparison is exact.

CREATE OR REPLACE FUNCTION collections_reject_slot_overfund()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_due        BIGINT;
    v_already    BIGINT;
    v_loan_type  TEXT;
    v_instalment BIGINT;
BEGIN
    -- Untargeted money (advance beyond the schedule) has no slot to overfund.
    IF NEW.target_due_date IS NULL OR NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT type, instalment_amount INTO v_loan_type, v_instalment
    FROM loans WHERE id = NEW.loan_id;

    -- Only fixed-instalment schedules have a per-slot amount to compare against.
    -- Interest-only loans accrue with time and settle irregularly, so a slot has
    -- no fixed ceiling; leave them to the application rules.
    IF v_loan_type IS DISTINCT FROM 'DAILY_COLLECTION' OR COALESCE(v_instalment, 0) <= 0 THEN
        RETURN NEW;
    END IF;
    v_due := v_instalment;

    -- What this slot already holds, excluding the row being updated.
    SELECT COALESCE(SUM(amount), 0) INTO v_already
    FROM collections
    WHERE loan_id = NEW.loan_id
      AND target_due_date = NEW.target_due_date
      AND deleted_at IS NULL
      AND id IS DISTINCT FROM NEW.id;

    IF v_already + NEW.amount > v_due THEN
        RAISE EXCEPTION
            'Instalment for % on loan % is already funded (% of %); this payment of % would overfund it by %',
            NEW.target_due_date, NEW.loan_id, v_already, v_due, NEW.amount,
            (v_already + NEW.amount) - v_due
            USING ERRCODE = 'check_violation',
                  HINT = 'A collection sheet entered twice looks exactly like this. Verify before re-recording.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_collections_reject_slot_overfund ON collections;
CREATE TRIGGER trg_collections_reject_slot_overfund
    BEFORE INSERT OR UPDATE OF amount, target_due_date, deleted_at ON collections
    FOR EACH ROW
    EXECUTE FUNCTION collections_reject_slot_overfund();

COMMENT ON FUNCTION collections_reject_slot_overfund() IS
    'Blocks funding a Daily Collection schedule slot beyond its instalment. '
    'Added after the Sept 2026 duplicate-entry incident; partial top-ups still '
    'allowed because the check is on AMOUNT, not row count.';
