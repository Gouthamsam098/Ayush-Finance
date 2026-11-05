ALTER TABLE recovery_submissions DROP COLUMN IF EXISTS edited_at;
ALTER TABLE collections          DROP COLUMN IF EXISTS payee_name;
ALTER TABLE collections          DROP COLUMN IF EXISTS payee_vpa;
ALTER TABLE recovery_submissions DROP COLUMN IF EXISTS payee_name;
ALTER TABLE recovery_submissions DROP COLUMN IF EXISTS payee_vpa;
