-- Customer portal payment proofs: a borrower pays by UPI and uploads the
-- screenshot from the portal; staff accept or reject it on the Collections page.
--
-- Accepting a proof records the payment as ordinary collection rows (mode UPI)
-- in the SAME transaction that marks the proof VERIFIED, so a proof can never
-- be accepted without its money landing, or its money land twice. Those rows
-- carry the idempotency key 'proof-<id>-<n>', which links them back here.
--
-- A proof is never money by itself: dashboards, reports and balances read only
-- collections, so PENDING and REJECTED proofs have no effect on any figure.

CREATE TABLE payment_proofs (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    loan_id      BIGINT       NOT NULL REFERENCES loans(id),
    customer_id  BIGINT       NOT NULL REFERENCES customers(id),
    amount       BIGINT       NOT NULL,              -- whole rupees, like collections.amount
    purpose      VARCHAR(20)  NOT NULL,              -- what the borrower chose to pay
    file_name    VARCHAR(255) NOT NULL,
    mime_type    VARCHAR(20)  NOT NULL,              -- sniffed from the bytes, not the client header
    size_bytes   INTEGER      NOT NULL,
    content      BYTEA        NOT NULL,              -- the screenshot; never returned in list queries
    status       VARCHAR(10)  NOT NULL DEFAULT 'PENDING',
    submitted_by BIGINT       REFERENCES users(id),
    submitted_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    reviewed_by  BIGINT       REFERENCES users(id),
    reviewed_at  TIMESTAMPTZ,
    receipt_date DATE,                               -- the date the accepted payment was recorded on
    deleted_at   TIMESTAMPTZ,
    CONSTRAINT payment_proofs_amount_positive CHECK (amount > 0),
    CONSTRAINT payment_proofs_purpose_valid CHECK (purpose IN ('INTEREST','FULL_SETTLEMENT','OUTSTANDING','CUSTOM')),
    CONSTRAINT payment_proofs_mime_valid CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
    CONSTRAINT payment_proofs_size_valid CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    CONSTRAINT payment_proofs_status_valid CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
    -- A reviewed proof always says who reviewed it and when.
    CONSTRAINT payment_proofs_review_stamped CHECK (
        (status = 'PENDING') = (reviewed_at IS NULL)
    ),
    CONSTRAINT payment_proofs_receipt_when_verified CHECK (
        (status = 'VERIFIED') = (receipt_date IS NOT NULL)
    )
);

CREATE INDEX idx_payment_proofs_customer ON payment_proofs(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payment_proofs_loan ON payment_proofs(loan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payment_proofs_pending ON payment_proofs(submitted_at DESC)
    WHERE deleted_at IS NULL AND status = 'PENDING';
