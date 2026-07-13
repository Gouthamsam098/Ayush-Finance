-- Migration 0002: KYC and contact fields on customers.
-- Aadhaar and PAN are sensitive; they are stored in full but the API masks
-- them in responses and they are never written to logs. Format is enforced
-- at the DB level as a backstop to the application-layer validation.

ALTER TABLE customers
    ADD COLUMN email          VARCHAR(255),
    ADD COLUMN date_of_birth  DATE,
    ADD COLUMN aadhaar_number VARCHAR(12),
    ADD COLUMN pan_number     VARCHAR(10);

-- Aadhaar: exactly 12 digits. PAN: 5 letters, 4 digits, 1 letter (uppercase).
ALTER TABLE customers
    ADD CONSTRAINT customers_aadhaar_digits
        CHECK (aadhaar_number IS NULL OR aadhaar_number ~ '^\d{12}$'),
    ADD CONSTRAINT customers_pan_format
        CHECK (pan_number IS NULL OR pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
    ADD CONSTRAINT customers_email_format
        CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- One active customer per PAN / Aadhaar (nulls allowed, duplicates of null ok).
CREATE UNIQUE INDEX idx_customers_pan_active
    ON customers(pan_number) WHERE deleted_at IS NULL AND pan_number IS NOT NULL;
CREATE UNIQUE INDEX idx_customers_aadhaar_active
    ON customers(aadhaar_number) WHERE deleted_at IS NULL AND aadhaar_number IS NOT NULL;
