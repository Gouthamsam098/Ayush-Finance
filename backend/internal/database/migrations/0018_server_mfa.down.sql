DROP TABLE IF EXISTS mfa_challenges;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_last_step;
UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL;
ALTER TABLE users ALTER COLUMN mfa_secret TYPE VARCHAR(64);
