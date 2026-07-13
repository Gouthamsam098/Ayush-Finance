-- Migration 0001: initial schema.
-- Money is stored as BIGINT paise (1 rupee = 100 paise); never a float type.
-- Dates that represent a calendar day use DATE; audit timestamps use
-- TIMESTAMPTZ. All tables carry created_at/updated_at; financial tables carry
-- deleted_at for soft deletes (records are never physically removed).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────── users ───────────────
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    full_name     VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,       -- bcrypt; never exposed in any API
    mfa_enabled   BOOLEAN      NOT NULL DEFAULT FALSE,
    mfa_secret    VARCHAR(64),                  -- TOTP seed (nullable until enrolled)
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT users_email_lower CHECK (email = lower(email))
);

-- ─────────────── customers ───────────────
CREATE TABLE customers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code             VARCHAR(20)  NOT NULL UNIQUE,       -- CUST-#### (human readable)
    name             VARCHAR(255) NOT NULL,
    father_name      VARCHAR(255),
    mobile           VARCHAR(10)  NOT NULL,
    alt_mobile       VARCHAR(10),
    address          TEXT,
    city             VARCHAR(100),
    state            VARCHAR(100),
    pincode          VARCHAR(10),
    occupation       VARCHAR(100),
    monthly_income   BIGINT,                              -- paise, nullable
    reference_name   VARCHAR(255),
    reference_mobile VARCHAR(10),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    CONSTRAINT customers_mobile_digits CHECK (mobile ~ '^\d{10}$'),
    CONSTRAINT customers_alt_mobile_digits CHECK (alt_mobile IS NULL OR alt_mobile ~ '^\d{10}$'),
    CONSTRAINT customers_income_non_negative CHECK (monthly_income IS NULL OR monthly_income >= 0)
);
CREATE UNIQUE INDEX idx_customers_mobile_active ON customers(mobile) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_created_at ON customers(created_at DESC);
CREATE INDEX idx_customers_name ON customers(lower(name));

-- ─────────────── loans ───────────────
CREATE TABLE loans (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_number    VARCHAR(20) NOT NULL UNIQUE,           -- LN-####
    customer_id    UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    type           VARCHAR(30) NOT NULL,
    principal      BIGINT      NOT NULL,                   -- paise
    rate           NUMERIC(6,3) NOT NULL,                 -- percent, e.g. 2.000
    interest       BIGINT      NOT NULL,                   -- paise, derived
    deduction      BIGINT,                                 -- paise, daily loans only
    daily_amount   BIGINT,                                 -- paise, daily loans only
    num_days       INTEGER,
    vehicle_number VARCHAR(50),
    vehicle_brand  VARCHAR(100),
    vehicle_name   VARCHAR(100),
    loan_date      DATE        NOT NULL,
    next_due_date  DATE,
    status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    contact        VARCHAR(10),
    remarks        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at      TIMESTAMPTZ,
    deleted_at     TIMESTAMPTZ,
    CONSTRAINT loans_type_valid CHECK (
        type IN ('DAILY_COLLECTION','MONTHLY_INTEREST','DAILY_INTEREST','VEHICLE','PROPERTY','FLEXIBLE')
    ),
    CONSTRAINT loans_status_valid CHECK (status IN ('ACTIVE','CLOSED')),
    CONSTRAINT loans_principal_positive CHECK (principal > 0),
    CONSTRAINT loans_rate_non_negative CHECK (rate >= 0),
    CONSTRAINT loans_interest_non_negative CHECK (interest >= 0),
    CONSTRAINT loans_daily_amount_positive CHECK (daily_amount IS NULL OR daily_amount > 0),
    CONSTRAINT loans_num_days_positive CHECK (num_days IS NULL OR num_days > 0)
);
CREATE INDEX idx_loans_customer_id ON loans(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_loans_status ON loans(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_loans_loan_date ON loans(loan_date DESC);

-- ─────────────── collections ───────────────
CREATE TABLE collections (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_no VARCHAR(20) NOT NULL UNIQUE,               -- RCPT-######
    loan_id    UUID        NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    date       DATE        NOT NULL,
    amount     BIGINT      NOT NULL,                       -- paise
    mode       VARCHAR(10) NOT NULL,
    remarks    TEXT,
    posted_at  TIMESTAMPTZ,                                -- NULL = unposted (editable)
    posted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT collections_amount_positive CHECK (amount > 0),
    CONSTRAINT collections_mode_valid CHECK (mode IN ('CASH','UPI','BANK','CHEQUE'))
);
CREATE INDEX idx_collections_loan_id ON collections(loan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_collections_date ON collections(date DESC);
CREATE INDEX idx_collections_loan_date ON collections(loan_id, date DESC) WHERE deleted_at IS NULL;

-- ─────────────── expenses ───────────────
CREATE TABLE expenses (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category     VARCHAR(100) NOT NULL,
    sub_category VARCHAR(100),
    name         VARCHAR(255) NOT NULL,
    amount       BIGINT       NOT NULL,                    -- paise
    mode         VARCHAR(10)  NOT NULL,
    date         DATE         NOT NULL,
    remarks      TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ,
    CONSTRAINT expenses_amount_positive CHECK (amount > 0),
    CONSTRAINT expenses_mode_valid CHECK (mode IN ('CASH','UPI','BANK','CHEQUE'))
);
CREATE INDEX idx_expenses_category ON expenses(category) WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_date ON expenses(date DESC);

-- ─────────────── documents ───────────────
CREATE TABLE documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    type        VARCHAR(100) NOT NULL,
    file_name   VARCHAR(255) NOT NULL,
    size_bytes  BIGINT       NOT NULL,
    mime_type   VARCHAR(100),
    storage_key VARCHAR(500) NOT NULL,
    file_hash   VARCHAR(64),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    date        DATE         NOT NULL DEFAULT CURRENT_DATE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT documents_size_positive CHECK (size_bytes > 0)
);
CREATE INDEX idx_documents_customer_id ON documents(customer_id) WHERE deleted_at IS NULL;

-- ─────────────── audit_log (append-only, immutable) ───────────────
CREATE TABLE audit_log (
    id           BIGSERIAL PRIMARY KEY,
    entity_type  VARCHAR(50) NOT NULL,
    entity_id    UUID        NOT NULL,
    action       VARCHAR(20) NOT NULL,
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    before_values JSONB,
    after_values  JSONB,
    ip_address   INET,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT audit_log_action_valid CHECK (
        action IN ('CREATE','UPDATE','DELETE','POST','APPROVE','LOGIN','MFA_SETUP')
    )
);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- ─────────────── sequences for human-readable codes ───────────────
-- Codes (CUST-####, LN-####, RCPT-######) are minted from dedicated
-- sequences so they are gap-tolerant, monotonic, and concurrency-safe.
CREATE SEQUENCE customer_code_seq START WITH 1001;
CREATE SEQUENCE loan_number_seq   START WITH 4001;
CREATE SEQUENCE receipt_no_seq    START WITH 100001;
