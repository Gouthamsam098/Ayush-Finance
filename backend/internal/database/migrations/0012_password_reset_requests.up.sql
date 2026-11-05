-- "Forgot password?" on the login page. There is no email/SMS channel, so a
-- request is a flag for an administrator: they confirm it is really the person
-- (offline), set a new password in Settings → Users, and share it. Setting that
-- password closes the request in the same transaction (user repository Update).
--
-- Only requests for a live, active account are stored; the login page shows the
-- same message either way, so it cannot reveal which emails have accounts. A
-- repeat request bumps request_count instead of adding rows, so the form cannot
-- be used to flood this table.
CREATE TABLE password_reset_requests (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           BIGINT       NOT NULL REFERENCES users(id),
    status            VARCHAR(10)  NOT NULL DEFAULT 'OPEN',
    request_count     INTEGER      NOT NULL DEFAULT 1,
    requested_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),   -- first request
    last_requested_at TIMESTAMPTZ  NOT NULL DEFAULT now(),   -- latest repeat
    resolved_at       TIMESTAMPTZ,
    resolved_by       BIGINT       REFERENCES users(id),
    CONSTRAINT password_reset_requests_status_valid CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
    CONSTRAINT password_reset_requests_count_positive CHECK (request_count > 0),
    -- An open request carries no resolution; a closed one always says when.
    CONSTRAINT password_reset_requests_resolution_stamped CHECK ((status = 'OPEN') = (resolved_at IS NULL))
);

-- At most ONE open request per user. Also the conflict target that lets a
-- repeat request update the open row atomically (no race can create two).
CREATE UNIQUE INDEX uq_password_reset_requests_open
    ON password_reset_requests(user_id) WHERE status = 'OPEN';
