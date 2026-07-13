-- Rollback of migration 0004: restore the AADHAAR/PAN-only constraint.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_valid;
ALTER TABLE documents
    ADD CONSTRAINT documents_type_valid CHECK (type IN ('AADHAAR', 'PAN'));
