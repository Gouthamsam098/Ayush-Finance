-- Migration 0003: store document content in Postgres.
-- The initial schema modelled documents for an object store (storage_key).
-- We instead store the file bytes directly in the DB, which keeps the system
-- dependency-free (no S3) and is adequate for KYC-scale files; the upload
-- endpoint enforces a per-file size cap. This migration reshapes the existing
-- documents table rather than creating a new one.

ALTER TABLE documents
    ADD COLUMN content BYTEA;

-- Object-store specific columns are no longer used.
ALTER TABLE documents
    DROP COLUMN IF EXISTS storage_key,
    DROP COLUMN IF EXISTS file_hash,
    DROP COLUMN IF EXISTS date;

-- Content and mime are required for in-DB storage. (Table is empty in every
-- current environment, so setting NOT NULL is safe.)
ALTER TABLE documents
    ALTER COLUMN content SET NOT NULL,
    ALTER COLUMN mime_type SET NOT NULL;

-- Restrict to the KYC document types the UI offers.
ALTER TABLE documents
    ADD CONSTRAINT documents_type_valid CHECK (type IN ('AADHAAR', 'PAN'));
