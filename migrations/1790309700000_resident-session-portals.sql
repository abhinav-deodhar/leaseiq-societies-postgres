-- Up Migration

ALTER TABLE auth_sessions
    DROP CONSTRAINT auth_sessions_portal_check,
    ADD CONSTRAINT auth_sessions_portal_check
        CHECK (portal IN ('chairman', 'admin', 'resident'));

ALTER TABLE mobile_sessions
    DROP CONSTRAINT mobile_sessions_portal_check,
    ADD CONSTRAINT mobile_sessions_portal_check
        CHECK (portal IN ('chairman', 'admin', 'resident'));

-- Down Migration

-- Reverting is refused if resident sessions exist.
-- No session records are silently deleted.
ALTER TABLE mobile_sessions
    DROP CONSTRAINT mobile_sessions_portal_check,
    ADD CONSTRAINT mobile_sessions_portal_check
        CHECK (portal IN ('chairman', 'admin'));

ALTER TABLE auth_sessions
    DROP CONSTRAINT auth_sessions_portal_check,
    ADD CONSTRAINT auth_sessions_portal_check
        CHECK (portal IN ('chairman', 'admin'));
