-- Recovery agents: field staff who collect overdue loans assigned to them.
--
-- An agent sees only their assigned loans and never records money directly:
-- they SUBMIT a collection claim (or a promise-to-pay date), and staff accept
-- it on the Recovery queue, which records the collection. Until now all of this
-- lived in one browser's localStorage, invisible to anyone else.

-- 1. Role -------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT users_role_valid;
ALTER TABLE users ADD CONSTRAINT users_role_valid
    CHECK (role IN ('ADMIN','VIEWER','CUSTOMER','RECOVERY_AGENT'));

-- 2. Who received the money -------------------------------------------------
-- Reports' "Collected by" (staff / recovery agent / customer portal) and the
-- per-agent collection report read these. Set by the SERVER from the posting
-- user or the approved claim/proof, never from client input.
ALTER TABLE collections ADD COLUMN collector_type    VARCHAR(20);
ALTER TABLE collections ADD COLUMN collector_name    VARCHAR(255);
ALTER TABLE collections ADD COLUMN collector_user_id BIGINT REFERENCES users(id);
ALTER TABLE collections ADD CONSTRAINT collections_collector_type_valid
    CHECK (collector_type IS NULL OR collector_type IN ('ADMIN','STAFF','RECOVERY_AGENT','CUSTOMER'));

-- Backfill existing receipts. Accepted portal proofs first (their rows carry the
-- 'proof-<id>-<n>' idempotency key), then everything else from the posting user.
UPDATE collections c
SET collector_type = 'CUSTOMER', collector_name = cu.name,
    collector_user_id = (SELECT u.id FROM users u WHERE u.customer_id = cu.id AND u.role = 'CUSTOMER'
                         ORDER BY u.deleted_at NULLS FIRST, u.id DESC LIMIT 1)
FROM loans l JOIN customers cu ON cu.id = l.customer_id
WHERE l.id = c.loan_id AND c.collector_type IS NULL AND c.idempotency_key LIKE 'proof-%';

UPDATE collections c
SET collector_type = CASE WHEN u.role = 'ADMIN' THEN 'ADMIN' ELSE 'STAFF' END,
    collector_name = u.full_name, collector_user_id = u.id
FROM users u
WHERE u.id = c.posted_by AND c.collector_type IS NULL;

-- 3. Loan assignments (one agent per loan) ----------------------------------
CREATE TABLE loan_assignments (
    loan_id       BIGINT      PRIMARY KEY REFERENCES loans(id),
    agent_user_id BIGINT      NOT NULL REFERENCES users(id),
    source        VARCHAR(10) NOT NULL,                -- MANUAL (Settings) | AUTO (daily job)
    assigned_by   BIGINT      REFERENCES users(id),     -- NULL for the daily job
    assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT loan_assignments_source_valid CHECK (source IN ('MANUAL','AUTO'))
);
CREATE INDEX idx_loan_assignments_agent ON loan_assignments(agent_user_id);

-- 4. Agent submissions: collection claims and promises to pay ---------------
CREATE TABLE recovery_submissions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type            VARCHAR(20)  NOT NULL,
    loan_id         BIGINT       NOT NULL REFERENCES loans(id),
    agent_user_id   BIGINT       NOT NULL REFERENCES users(id),
    status          VARCHAR(10)  NOT NULL,
    amount          BIGINT,                             -- claim: whole rupees
    mode            VARCHAR(10),                        -- claim
    receipt_date    DATE,                               -- claim: when the agent received it
    promise_date    DATE,                               -- promise
    promised_amount BIGINT,                             -- promise (optional), whole rupees
    note            VARCHAR(500),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    reviewed_by     BIGINT       REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    review_note     VARCHAR(300),
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT recovery_submissions_type_valid CHECK (type IN ('COLLECTION_CLAIM','PROMISE_TO_PAY')),
    CONSTRAINT recovery_submissions_claim_shape CHECK (
        type <> 'COLLECTION_CLAIM' OR (
            status IN ('PENDING','APPROVED','REJECTED')
            AND amount > 0 AND receipt_date IS NOT NULL
            AND mode IN ('CASH','UPI','BANK','CHEQUE'))),
    CONSTRAINT recovery_submissions_promise_shape CHECK (
        type <> 'PROMISE_TO_PAY' OR (
            status IN ('OPEN','FULFILLED','CANCELLED')
            AND promise_date IS NOT NULL
            AND (promised_amount IS NULL OR promised_amount > 0))),
    CONSTRAINT recovery_submissions_review_stamped CHECK (
        (status IN ('APPROVED','REJECTED')) = (reviewed_at IS NOT NULL))
);
-- At most one claim awaiting approval per loan (any agent).
CREATE UNIQUE INDEX idx_recovery_one_pending_claim
    ON recovery_submissions(loan_id)
    WHERE type = 'COLLECTION_CLAIM' AND status = 'PENDING' AND deleted_at IS NULL;
CREATE INDEX idx_recovery_submissions_agent ON recovery_submissions(agent_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_recovery_submissions_queue ON recovery_submissions(created_at DESC)
    WHERE deleted_at IS NULL AND status IN ('PENDING','OPEN');

-- 5. Daily auto-assign schedule (single row) --------------------------------
CREATE TABLE recovery_auto_assign (
    id            SMALLINT     PRIMARY KEY DEFAULT 1,
    run_time      VARCHAR(5),                           -- local HH:MM; NULL = midnight
    last_run_slot VARCHAR(20),                          -- 'YYYY-MM-DD' or 'YYYY-MM-DD|HH:MM'
    last_run_at   TIMESTAMPTZ,
    last_result   JSONB,
    updated_by    BIGINT       REFERENCES users(id),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT recovery_auto_assign_singleton CHECK (id = 1),
    CONSTRAINT recovery_auto_assign_time_valid CHECK (run_time IS NULL OR run_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
INSERT INTO recovery_auto_assign (id) VALUES (1);
