-- Up Migration

-- Incremented when credentials are reset. Authentication operations must
-- recheck this revision under the account lock before issuing a session.
ALTER TABLE users
  ADD COLUMN credential_revision INTEGER NOT NULL DEFAULT 0
  CHECK (credential_revision >= 0);

CREATE TABLE email_auth_limits (
  key_hash TEXT PRIMARY KEY
    CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scope TEXT NOT NULL
    CHECK (scope IN ('request', 'verify')),
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > window_started_at),
  CHECK (last_attempt_at >= window_started_at)
);

CREATE INDEX email_auth_limits_expiry_idx
  ON email_auth_limits(expires_at);

CREATE TABLE email_auth_challenges (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  portal TEXT NOT NULL CHECK (portal IN ('chairman', 'resident')),
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'reset_password')),
  destination TEXT NOT NULL CHECK (
    destination = lower(btrim(destination))
    AND char_length(destination) BETWEEN 3 AND 254
    AND position('@' IN destination) > 1
  ),
  credential_revision INTEGER NOT NULL CHECK (credential_revision >= 0),
  code_hash TEXT NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts = 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  CHECK (attempts BETWEEN 0 AND max_attempts),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),
  CHECK (consumed_at IS NULL OR invalidated_at IS NULL),
  UNIQUE (id, user_id, portal)
);

-- Expired challenges must also be invalidated before issuing replacements.
CREATE UNIQUE INDEX email_auth_challenges_open_idx
  ON email_auth_challenges(user_id, portal, purpose)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX email_auth_challenges_history_idx
  ON email_auth_challenges(user_id, created_at DESC);

CREATE INDEX email_auth_challenges_expiry_idx
  ON email_auth_challenges(expires_at);

-- A verified reset code grants only permission to set a new password.
-- Raw reset tokens are never stored.
CREATE TABLE email_password_reset_grants (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  challenge_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  portal TEXT NOT NULL CHECK (portal IN ('chairman', 'resident')),
  credential_revision INTEGER NOT NULL CHECK (credential_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  FOREIGN KEY (challenge_id, user_id, portal)
    REFERENCES email_auth_challenges(id, user_id, portal),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),
  CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
);

CREATE INDEX email_password_reset_grants_user_idx
  ON email_password_reset_grants(user_id);

CREATE INDEX email_password_reset_grants_expiry_idx
  ON email_password_reset_grants(expires_at);

-- No passwords, raw codes, reset tokens or email contents in audit events.
CREATE TABLE email_auth_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  portal TEXT NOT NULL CHECK (portal IN ('chairman', 'resident')),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('email_login', 'password_reset')
  ),
  credential_revision INTEGER NOT NULL CHECK (credential_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX email_auth_events_user_idx
  ON email_auth_events(user_id, created_at DESC);

-- Down Migration

-- Refuse an automatic downgrade after the feature has been used.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM email_auth_challenges)
     OR EXISTS (SELECT 1 FROM email_password_reset_grants)
     OR EXISTS (SELECT 1 FROM email_auth_events)
     OR EXISTS (SELECT 1 FROM users WHERE credential_revision <> 0)
  THEN
    RAISE EXCEPTION
      'Email authentication data exists. Review recovery before downgrading.';
  END IF;
END
$$;

DROP TABLE email_auth_events;
DROP TABLE email_password_reset_grants;
DROP TABLE email_auth_challenges;
DROP TABLE email_auth_limits;
ALTER TABLE users DROP COLUMN credential_revision;
