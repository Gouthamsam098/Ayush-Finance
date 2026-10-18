DROP TABLE IF EXISTS recovery_auto_assign;
DROP TABLE IF EXISTS recovery_submissions;
DROP TABLE IF EXISTS loan_assignments;
ALTER TABLE collections DROP CONSTRAINT IF EXISTS collections_collector_type_valid;
ALTER TABLE collections DROP COLUMN IF EXISTS collector_user_id;
ALTER TABLE collections DROP COLUMN IF EXISTS collector_name;
ALTER TABLE collections DROP COLUMN IF EXISTS collector_type;
UPDATE users SET deleted_at = COALESCE(deleted_at, now()), is_active = FALSE, role = 'VIEWER'
 WHERE role = 'RECOVERY_AGENT';
ALTER TABLE users DROP CONSTRAINT users_role_valid;
ALTER TABLE users ADD CONSTRAINT users_role_valid CHECK (role IN ('ADMIN','VIEWER','CUSTOMER'));
