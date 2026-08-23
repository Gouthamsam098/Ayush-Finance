-- Investments: capital the business BORROWS from investors, and the interest
-- payouts that capital costs. The mirror image of an interest-only loan — the
-- investor is the lender and every payout is a business expense.
--
-- Purely ADDITIVE: no existing table is altered, so every current workflow is
-- untouched. Money is stored in whole rupees (BIGINT), matching the loans,
-- collections and expenses tables (domain.Paise handles paise at the boundary).

CREATE SEQUENCE IF NOT EXISTS investment_code_seq START 4001;

CREATE TABLE IF NOT EXISTS investments (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            TEXT        NOT NULL UNIQUE,          -- INV-####
    investor_name   TEXT        NOT NULL,
    mobile          TEXT,
    email           TEXT,
    principal       BIGINT      NOT NULL,                 -- rupees received
    rate            NUMERIC(6,3) NOT NULL,                -- % PER CYCLE
    frequency       TEXT        NOT NULL,                 -- MONTHLY | YEARLY
    start_date      DATE        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'ACTIVE',-- ACTIVE | CLOSED
    settled_date    DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT investments_principal_positive CHECK (principal > 0),
    CONSTRAINT investments_rate_valid         CHECK (rate > 0 AND rate <= 100),
    CONSTRAINT investments_frequency_valid    CHECK (frequency IN ('MONTHLY','YEARLY')),
    CONSTRAINT investments_status_valid       CHECK (status IN ('ACTIVE','CLOSED')),
    -- A settled investment must carry its settlement date, and vice versa.
    CONSTRAINT investments_settled_consistent CHECK (
        (status = 'CLOSED' AND settled_date IS NOT NULL)
        OR (status = 'ACTIVE' AND settled_date IS NULL)
    ),
    CONSTRAINT investments_settled_after_start CHECK (
        settled_date IS NULL OR settled_date >= start_date
    )
);

CREATE INDEX IF NOT EXISTS investments_status_idx ON investments (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS investments_name_idx   ON investments (lower(investor_name)) WHERE deleted_at IS NULL;

-- One interest payout to an investor. expense_id links the Expenses row this
-- payout created: the expense is the authoritative COST record, and the FK
-- keeps the two from silently diverging.
CREATE TABLE IF NOT EXISTS investor_payouts (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    investment_id   BIGINT      NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
    expense_id      BIGINT      REFERENCES expenses(id) ON DELETE SET NULL,
    date            DATE        NOT NULL,                 -- when the money left
    amount          BIGINT      NOT NULL,
    mode            TEXT        NOT NULL,
    remarks         TEXT,
    posted_by       BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    posted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT investor_payouts_amount_positive CHECK (amount > 0),
    CONSTRAINT investor_payouts_mode_valid      CHECK (mode IN ('CASH','UPI','BANK','CHEQUE'))
);

CREATE INDEX IF NOT EXISTS investor_payouts_investment_idx ON investor_payouts (investment_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS investor_payouts_date_idx       ON investor_payouts (date) WHERE deleted_at IS NULL;
