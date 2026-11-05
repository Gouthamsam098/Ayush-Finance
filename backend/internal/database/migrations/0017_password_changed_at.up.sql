-- Sessions end when the password changes.
--
-- An access token stayed valid for its whole hour even after the password was
-- changed or reset — the usual reason being that someone else knew it. Every
-- password write now stamps password_changed_at, and a token issued before
-- that moment is refused. NULL = never changed since this column existed (no
-- cutoff).
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;
