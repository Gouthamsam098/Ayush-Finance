DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
DROP FUNCTION IF EXISTS audit_log_append_only();
DROP INDEX IF EXISTS idx_audit_log_user;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_valid;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_valid CHECK (
    action IN ('CREATE','UPDATE','DELETE','POST','APPROVE','LOGIN','MFA_SETUP')
);
