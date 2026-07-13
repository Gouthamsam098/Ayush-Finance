-- Rollback of migration 0003.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_valid;

ALTER TABLE documents
    ALTER COLUMN mime_type DROP NOT NULL;

ALTER TABLE documents
    DROP COLUMN IF EXISTS content,
    ADD COLUMN storage_key VARCHAR(500),
    ADD COLUMN file_hash   VARCHAR(64),
    ADD COLUMN date        DATE NOT NULL DEFAULT CURRENT_DATE;
