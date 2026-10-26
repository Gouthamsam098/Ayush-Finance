-- The UPI ID (and payee name) borrowers pay to, one per loan type.
--
-- Until now these lived in the admin's browser (localStorage), so a borrower
-- opening the portal on their own phone never saw them and could not pay. The
-- admin saves all six together (Settings → Customer portal · UPI IDs); the
-- portal and recovery agents read them from here.

CREATE TABLE loan_type_upi (
    loan_type  VARCHAR(30)  PRIMARY KEY,
    payee_vpa  VARCHAR(256) NOT NULL,              -- stored trimmed + lowercase
    payee_name VARCHAR(80)  NOT NULL,
    updated_by BIGINT       REFERENCES users(id),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT loan_type_upi_type_valid CHECK (
        loan_type IN ('DAILY_COLLECTION','DAILY_INTEREST','MONTHLY_INTEREST','FLEXIBLE','VEHICLE','PROPERTY')
    ),
    -- Length is capped by the column (Postgres regex counts stop at 255).
    CONSTRAINT loan_type_upi_vpa_valid CHECK (payee_vpa ~ '^[a-z0-9._-]{2,}@[a-z]{2,}$'),
    CONSTRAINT loan_type_upi_name_valid CHECK (char_length(btrim(payee_name)) BETWEEN 2 AND 80)
);
