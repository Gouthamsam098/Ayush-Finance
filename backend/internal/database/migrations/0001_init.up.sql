-- Migration 0001: initial schema (consolidated).
--
-- IDs: every table uses a BIGINT auto-increment identity as the primary key
-- (1, 2, 3, …). Human-readable business codes (CUST-####, LN-####, RCPT-######)
-- are separate columns minted from sequences.
--
-- Money is stored as BIGINT whole rupees (validated whole-rupee at input);
-- never a float type. Internal Go math uses integer paise, converted to whole
-- rupees only at the DB boundary (see domain.Paise.DBRupees).
-- Calendar days use DATE; audit timestamps use TIMESTAMPTZ. Financial tables
-- carry deleted_at for soft deletes (records are never physically removed).

-- ─────────────── users ───────────────
CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    full_name     VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,       -- bcrypt; never exposed in any API
    mfa_enabled   BOOLEAN      NOT NULL DEFAULT FALSE,
    mfa_secret    VARCHAR(64),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT users_email_lower CHECK (email = lower(email))
);

-- ─────────────── customers ───────────────
CREATE TABLE customers (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code             VARCHAR(20)  NOT NULL UNIQUE,       -- CUST-#### (human readable)
    name             VARCHAR(255) NOT NULL,
    father_name      VARCHAR(255),
    mobile           VARCHAR(10)  NOT NULL,
    alt_mobile       VARCHAR(10),
    email            VARCHAR(255),
    date_of_birth    DATE,
    address          TEXT,
    city             VARCHAR(100),
    state            VARCHAR(100),
    pincode          VARCHAR(10),
    occupation       VARCHAR(100),
    monthly_income   BIGINT,                              -- rupees, nullable
    reference_name   VARCHAR(255),
    reference_mobile VARCHAR(10),
    aadhaar_number   VARCHAR(12),                         -- raw; masked in API, never logged
    pan_number       VARCHAR(10),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    CONSTRAINT customers_mobile_digits CHECK (mobile ~ '^\d{10}$'),
    CONSTRAINT customers_alt_mobile_digits CHECK (alt_mobile IS NULL OR alt_mobile ~ '^\d{10}$'),
    CONSTRAINT customers_income_non_negative CHECK (monthly_income IS NULL OR monthly_income >= 0),
    CONSTRAINT customers_aadhaar_digits CHECK (aadhaar_number IS NULL OR aadhaar_number ~ '^\d{12}$'),
    CONSTRAINT customers_pan_format CHECK (pan_number IS NULL OR pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$')
);
CREATE UNIQUE INDEX idx_customers_mobile_active ON customers(mobile) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_customers_aadhaar_active ON customers(aadhaar_number) WHERE deleted_at IS NULL AND aadhaar_number IS NOT NULL;
CREATE UNIQUE INDEX idx_customers_pan_active ON customers(pan_number) WHERE deleted_at IS NULL AND pan_number IS NOT NULL;
CREATE INDEX idx_customers_created_at ON customers(created_at DESC);
CREATE INDEX idx_customers_name ON customers(lower(name));

-- ─────────────── loans ───────────────
-- Six products, three behaviours (see domain/loan.go). Per-type CHECK
-- constraints keep the single table honest.
CREATE TABLE loans (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    loan_number       VARCHAR(20) NOT NULL UNIQUE,           -- LN-####
    customer_id       BIGINT      NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    type              VARCHAR(30) NOT NULL,
    principal         BIGINT      NOT NULL,                   -- rupees
    rate              NUMERIC(6,3) NOT NULL,                 -- percent
    interest          BIGINT      NOT NULL,                   -- rupees, derived
    deduction         BIGINT,                                 -- rupees, Daily Collection only
    disbursed_amount  BIGINT      NOT NULL,                   -- rupees, derived: principal − deduction (net cash given)
    instalment_amount BIGINT,                                 -- rupees: daily / EMI / per-period interest
    num_days          INTEGER,
    vehicle_number    VARCHAR(50),
    vehicle_brand     VARCHAR(100),
    vehicle_name      VARCHAR(100),
    loan_date         DATE        NOT NULL,
    next_due_date     DATE,
    status            VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    contact           VARCHAR(10),
    remarks           TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at         TIMESTAMPTZ,
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT loans_type_valid CHECK (
        type IN ('DAILY_COLLECTION','VEHICLE','PROPERTY','DAILY_INTEREST','MONTHLY_INTEREST','FLEXIBLE')
    ),
    CONSTRAINT loans_status_valid CHECK (status IN ('ACTIVE','CLOSED')),
    CONSTRAINT loans_principal_positive CHECK (principal > 0),
    -- Disbursed is the net cash given: principal minus any upfront deduction.
    CONSTRAINT loans_disbursed_consistent CHECK (disbursed_amount = principal - COALESCE(deduction, 0)),
    CONSTRAINT loans_rate_non_negative CHECK (rate >= 0),
    CONSTRAINT loans_interest_non_negative CHECK (interest >= 0),
    CONSTRAINT loans_num_days_positive CHECK (num_days IS NULL OR num_days > 0),
    -- Vehicle number required for (and only present on) Vehicle loans.
    CONSTRAINT loans_vehicle_number_required CHECK (
        CASE WHEN type = 'VEHICLE' THEN vehicle_number IS NOT NULL ELSE vehicle_number IS NULL END
    ),
    -- num_days required except for open-ended interest-only loans.
    CONSTRAINT loans_num_days_by_type CHECK (
        CASE WHEN type IN ('DAILY_INTEREST','MONTHLY_INTEREST') THEN num_days IS NULL
             ELSE num_days IS NOT NULL AND num_days > 0 END
    ),
    -- instalment_amount (per-period amount / interest) required for every type.
    CONSTRAINT loans_instalment_amount_by_type CHECK (
        instalment_amount IS NOT NULL AND instalment_amount > 0
    ),
    -- Upfront deduction only on Daily Collection.
    CONSTRAINT loans_deduction_by_type CHECK (
        type = 'DAILY_COLLECTION' OR deduction IS NULL
    )
);
CREATE INDEX idx_loans_customer_active ON loans (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_loans_status_active   ON loans (status)      WHERE deleted_at IS NULL;
CREATE INDEX idx_loans_next_due_active ON loans (next_due_date) WHERE deleted_at IS NULL AND status = 'ACTIVE';
CREATE INDEX idx_loans_loan_date ON loans(loan_date DESC);

-- ─────────────── collections ───────────────
CREATE TABLE collections (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receipt_no VARCHAR(20) NOT NULL UNIQUE,               -- RCPT-######
    loan_id    BIGINT      NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    date       DATE        NOT NULL,
    amount     BIGINT      NOT NULL,                       -- rupees
    mode       VARCHAR(10) NOT NULL,
    kind       VARCHAR(10) NOT NULL DEFAULT 'INTEREST',    -- INTEREST (income) | PRINCIPAL (repayment/settlement)
    remarks    TEXT,
    posted_at  TIMESTAMPTZ,
    posted_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT collections_amount_positive CHECK (amount > 0),
    CONSTRAINT collections_mode_valid CHECK (mode IN ('CASH','UPI','BANK','CHEQUE')),
    CONSTRAINT collections_kind_valid CHECK (kind IN ('INTEREST','PRINCIPAL'))
);
CREATE INDEX idx_collections_loan_id ON collections(loan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_collections_date ON collections(date DESC);
CREATE INDEX idx_collections_loan_date ON collections(loan_id, date DESC) WHERE deleted_at IS NULL;

-- ─────────────── expenses ───────────────
CREATE TABLE expenses (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category     VARCHAR(100) NOT NULL,
    sub_category VARCHAR(100),
    name         VARCHAR(255) NOT NULL,
    amount       BIGINT       NOT NULL,                    -- rupees
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
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id BIGINT       NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    type        VARCHAR(100) NOT NULL,
    file_name   VARCHAR(255) NOT NULL,
    mime_type   VARCHAR(100),
    size_bytes  BIGINT       NOT NULL,
    content     BYTEA        NOT NULL,   -- raw file bytes stored in-DB (no object store)
    uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT documents_size_positive CHECK (size_bytes > 0),
    CONSTRAINT documents_type_valid CHECK (type IN ('AADHAAR','PAN','LICENSE','RC','PROPERTY'))
);
CREATE INDEX idx_documents_customer_id ON documents(customer_id) WHERE deleted_at IS NULL;

-- ─────────────── audit_log (append-only) ───────────────
CREATE TABLE audit_log (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type  VARCHAR(50) NOT NULL,
    entity_id    BIGINT      NOT NULL,
    action       VARCHAR(20) NOT NULL,
    user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
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
CREATE SEQUENCE customer_code_seq START WITH 1001;
CREATE SEQUENCE loan_number_seq   START WITH 4001;
CREATE SEQUENCE receipt_no_seq    START WITH 100001;

-- ─────────────── human-readable views ───────────────
-- Money columns already store whole rupees; these views add the customer join
-- and friendly column names for quick manual inspection.
CREATE VIEW loans_readable AS
SELECT
    l.id,
    l.loan_number,
    c.name              AS customer,
    l.type,
    l.principal         AS principal_rupees,
    l.rate              AS rate_percent,
    l.interest          AS interest_rupees,
    l.deduction         AS deduction_rupees,
    l.disbursed_amount  AS disbursed_rupees,
    l.instalment_amount AS instalment_rupees,
    l.num_days          AS term,
    l.loan_date, l.next_due_date, l.status, l.contact, l.created_at, l.closed_at
FROM loans l JOIN customers c ON c.id = l.customer_id
WHERE l.deleted_at IS NULL
ORDER BY l.id;

CREATE VIEW customers_readable AS
SELECT id, code, name, mobile, city, state,
    monthly_income AS monthly_income_rupees, created_at
FROM customers WHERE deleted_at IS NULL ORDER BY id;
