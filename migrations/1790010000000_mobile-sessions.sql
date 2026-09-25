-- Up Migration

-- One persistent session represents one mobile sign-in.
-- There is deliberately no fixed expiry for this session.
-- Access tokens still expire; logout revokes the parent session.
CREATE TABLE mobile_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id),

    portal TEXT NOT NULL
        CHECK (portal IN ('chairman', 'admin')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_refreshed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,

    CONSTRAINT mobile_sessions_identity_unique
        UNIQUE (id, user_id, portal),

    CONSTRAINT mobile_sessions_revocation_consistent CHECK (
        (
            revoked_at IS NULL
            AND revocation_reason IS NULL
        )
        OR
        (
            revoked_at IS NOT NULL
            AND revocation_reason IS NOT NULL
            AND char_length(btrim(revocation_reason)) BETWEEN 1 AND 200
        )
    )
);

CREATE INDEX mobile_sessions_user_id_idx
    ON mobile_sessions(user_id);

-- Retain consumed hashes to identify refresh-token reuse.
-- Raw refresh tokens must never be stored here.
CREATE TABLE mobile_refresh_tokens (
    token_hash TEXT PRIMARY KEY
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),

    mobile_session_id UUID NOT NULL REFERENCES mobile_sessions(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    consumed_at TIMESTAMPTZ,

    CONSTRAINT mobile_refresh_tokens_consumption_time CHECK (
        consumed_at IS NULL OR consumed_at >= created_at
    )
);

-- Only one unconsumed refresh token may exist per mobile session.
-- Rotation must consume the old token before inserting its replacement,
-- within the same transaction.
CREATE UNIQUE INDEX mobile_refresh_tokens_current_idx
    ON mobile_refresh_tokens(mobile_session_id)
    WHERE consumed_at IS NULL;

CREATE INDEX mobile_refresh_tokens_session_id_idx
    ON mobile_refresh_tokens(mobile_session_id);

-- Existing sessions retain NULL here and continue working as before.
ALTER TABLE auth_sessions
    ADD COLUMN mobile_session_id UUID;

-- An access token cannot be attached to another user's or portal's
-- mobile session.
ALTER TABLE auth_sessions
    ADD CONSTRAINT auth_sessions_mobile_session_fk
    FOREIGN KEY (mobile_session_id, user_id, portal)
    REFERENCES mobile_sessions(id, user_id, portal);

CREATE INDEX auth_sessions_mobile_session_id_idx
    ON auth_sessions(mobile_session_id)
    WHERE mobile_session_id IS NOT NULL;

-- Down Migration

ALTER TABLE auth_sessions
    DROP CONSTRAINT auth_sessions_mobile_session_fk;

DROP INDEX auth_sessions_mobile_session_id_idx;

ALTER TABLE auth_sessions
    DROP COLUMN mobile_session_id;

DROP TABLE mobile_refresh_tokens;
DROP TABLE mobile_sessions;