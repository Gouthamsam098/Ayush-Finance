-- Wider audit trail + append-only audit_log.
--
-- The trail now covers sign-ins (successful and refused), user/role/permission,
-- password and two-factor changes, KYC document uploads/downloads/deletes,
-- loans, customers, expenses and investments — not only payments. Two new
-- verbs are needed for that: LOGIN_FAILED and DOWNLOAD.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_valid;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_valid CHECK (
    action IN ('CREATE','UPDATE','DELETE','POST','APPROVE','LOGIN','MFA_SETUP','LOGIN_FAILED','DOWNLOAD')
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (user_id, created_at DESC);

-- Append-only: an audit row, once written, cannot be edited or removed through
-- the application's connection. The one update allowed is the foreign key's
-- own ON DELETE SET NULL on user_id (if a user row is ever hard-deleted), which
-- changes nothing else.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
       AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
