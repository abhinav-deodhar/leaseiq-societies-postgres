-- Up Migration

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    full_name TEXT NOT NULL
        CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),

    email TEXT NOT NULL UNIQUE
        CHECK (
            email = lower(btrim(email))
            AND char_length(email) BETWEEN 3 AND 254
            AND position('@' IN email) > 1
        ),

    phone TEXT NOT NULL UNIQUE
        CHECK (phone ~ '^[+]91[0-9]{10}$'),

    password_hash TEXT,

    email_verified_at TIMESTAMPTZ,
    phone_verified_at TIMESTAMPTZ,

    status TEXT NOT NULL DEFAULT 'pending_verification'
        CHECK (status IN (
            'pending_verification',
            'active',
            'disabled'
        )),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT active_user_requires_verification CHECK (
        status <> 'active'
        OR (
            email_verified_at IS NOT NULL
            AND phone_verified_at IS NOT NULL
        )
    )
);

CREATE TABLE platform_admins (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id),

    token_hash TEXT NOT NULL UNIQUE
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,

    CONSTRAINT valid_session_expiry CHECK (
        expires_at > created_at
    )
);

CREATE INDEX auth_sessions_user_id_idx
    ON auth_sessions(user_id);

CREATE INDEX auth_sessions_expires_at_idx
    ON auth_sessions(expires_at);

CREATE TABLE verification_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id),

    purpose TEXT NOT NULL
        CHECK (purpose IN (
            'verify_email',
            'verify_phone',
            'login_phone',
            'reset_password'
        )),

    channel TEXT NOT NULL
        CHECK (channel IN ('email', 'sms')),

    destination TEXT NOT NULL
        CHECK (char_length(btrim(destination)) BETWEEN 3 AND 254),

    code_hash TEXT NOT NULL
        CHECK (code_hash ~ '^[0-9a-f]{64}$'),

    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5
        CHECK (max_attempts BETWEEN 1 AND 10),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,

    CONSTRAINT valid_verification_attempts CHECK (
        attempts >= 0 AND attempts <= max_attempts
    ),

    CONSTRAINT valid_verification_expiry CHECK (
        expires_at > created_at
    ),

    CONSTRAINT valid_verification_channel CHECK (
        (purpose = 'verify_email' AND channel = 'email')
        OR (purpose IN ('verify_phone', 'login_phone') AND channel = 'sms')
        OR purpose = 'reset_password'
    )
);

CREATE INDEX verification_challenges_user_purpose_idx
    ON verification_challenges(user_id, purpose, created_at DESC);

CREATE INDEX verification_challenges_expires_at_idx
    ON verification_challenges(expires_at);

-- Down Migration

DROP TABLE verification_challenges;
DROP TABLE auth_sessions;
DROP TABLE platform_admins;
DROP TABLE users;