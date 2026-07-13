-- Migration 0004: widen document types for loan-specific KYC.
-- Vehicle loans add LICENSE + RC; property loans add PROPERTY.

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_valid;
ALTER TABLE documents
    ADD CONSTRAINT documents_type_valid
        CHECK (type IN ('AADHAAR', 'PAN', 'LICENSE', 'RC', 'PROPERTY'));
