-- Rollback of migration 0002.
DROP INDEX IF EXISTS idx_customers_aadhaar_active;
DROP INDEX IF EXISTS idx_customers_pan_active;

ALTER TABLE customers
    DROP CONSTRAINT IF EXISTS customers_email_format,
    DROP CONSTRAINT IF EXISTS customers_pan_format,
    DROP CONSTRAINT IF EXISTS customers_aadhaar_digits;

ALTER TABLE customers
    DROP COLUMN IF EXISTS pan_number,
    DROP COLUMN IF EXISTS aadhaar_number,
    DROP COLUMN IF EXISTS date_of_birth,
    DROP COLUMN IF EXISTS email;
