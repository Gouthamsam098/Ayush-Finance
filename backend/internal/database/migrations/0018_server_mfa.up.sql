-- Two-factor authentication enforced by the server.
--
-- Until now 2FA lived in the browser: the secret was kept in localStorage, the
-- code was checked by the browser after the server had already issued a full
-- session, and the QR code was drawn by an outside website (sending it the
-- secret). Anyone with the password could sign in from any other device.
--
-- Now the secret is generated and kept by the server (encrypted — see
-- crypto.SecretBox), and an account with 2FA on gets no session until the code
-- is verified: login returns a short-lived, single-use challenge instead.

-- Encrypted secrets are longer than the raw base32 secret.
ALTER TABLE users ALTER COLUMN mfa_secret TYPE VARCHAR(200);
-- The last accepted 30-second step: a code can never be used twice.
ALTER TABLE users ADD COLUMN mfa_last_step BIGINT;
-- Nothing ever set these server-side; make sure no account is half-enrolled.
UPDATE users SET mfa_enabled = FALSE WHERE mfa_enabled AND mfa_secret IS NULL;

-- Pending second steps of a login. Only a hash of the token is stored.
CREATE TABLE mfa_challenges (
    token_hash BYTEA       PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts   INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mfa_challenges_expires ON mfa_challenges(expires_at);
