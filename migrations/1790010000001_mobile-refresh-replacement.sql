-- Up Migration

-- Record the successor of a consumed refresh token so an identical
-- renewal retry can be distinguished from a different reuse attempt.
-- Store only the hash, never the raw replacement token.
ALTER TABLE mobile_refresh_tokens
    ADD COLUMN replacement_token_hash TEXT;

ALTER TABLE mobile_refresh_tokens
    ADD CONSTRAINT mobile_refresh_replacement_format CHECK (
        replacement_token_hash IS NULL
        OR replacement_token_hash ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT mobile_refresh_replacement_not_self CHECK (
        replacement_token_hash IS NULL
        OR replacement_token_hash <> token_hash
    ),
    ADD CONSTRAINT mobile_refresh_replacement_requires_consumption CHECK (
        replacement_token_hash IS NULL
        OR consumed_at IS NOT NULL
    ),
    ADD CONSTRAINT mobile_refresh_token_session_unique
        UNIQUE (token_hash, mobile_session_id),
    ADD CONSTRAINT mobile_refresh_replacement_unique
        UNIQUE (replacement_token_hash);

-- The replacement must belong to the same mobile session.
-- Defer this check until commit so rotation can consume the old token
-- before inserting the new one, respecting the one-current-token index.
ALTER TABLE mobile_refresh_tokens
    ADD CONSTRAINT mobile_refresh_replacement_fk
    FOREIGN KEY (replacement_token_hash, mobile_session_id)
    REFERENCES mobile_refresh_tokens(token_hash, mobile_session_id)
    DEFERRABLE INITIALLY DEFERRED;

-- Down Migration

ALTER TABLE mobile_refresh_tokens
    DROP CONSTRAINT mobile_refresh_replacement_fk,
    DROP CONSTRAINT mobile_refresh_replacement_unique,
    DROP CONSTRAINT mobile_refresh_token_session_unique,
    DROP CONSTRAINT mobile_refresh_replacement_requires_consumption,
    DROP CONSTRAINT mobile_refresh_replacement_not_self,
    DROP CONSTRAINT mobile_refresh_replacement_format,
    DROP COLUMN replacement_token_hash;
