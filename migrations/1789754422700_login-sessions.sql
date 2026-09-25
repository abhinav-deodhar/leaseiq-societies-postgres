-- Up Migration

ALTER TABLE auth_sessions
ADD COLUMN portal TEXT NOT NULL DEFAULT 'chairman'
CHECK (portal IN ('chairman', 'admin'));

CREATE TABLE login_limits (
    key_hash TEXT PRIMARY KEY
        CHECK (key_hash ~ '^[0-9a-f]{64}$'),

    attempts INTEGER NOT NULL CHECK (attempts > 0),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX login_limits_expiry_idx
    ON login_limits(expires_at);

-- Down Migration

DROP TABLE login_limits;
ALTER TABLE auth_sessions DROP COLUMN portal;