-- Up Migration

ALTER TABLE users
ADD COLUMN verification_policy TEXT NOT NULL DEFAULT 'email_and_phone'
    CHECK (verification_policy IN ('email_only', 'email_and_phone'));

ALTER TABLE users
DROP CONSTRAINT active_user_requires_verification;

ALTER TABLE users
ADD CONSTRAINT active_user_requires_verification CHECK (
    status <> 'active'
    OR (
        email_verified_at IS NOT NULL
        AND (
            verification_policy = 'email_only'
            OR phone_verified_at IS NOT NULL
        )
    )
);

COMMENT ON COLUMN users.verification_policy IS
    'Server-selected account activation requirement. Does not imply phone ownership.';

-- Down Migration

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM users
        WHERE status = 'active'
          AND phone_verified_at IS NULL
    ) THEN
        RAISE EXCEPTION
            'Cannot restore dual verification while active email-only accounts exist.';
    END IF;
END
$$;

ALTER TABLE users
DROP CONSTRAINT active_user_requires_verification;

ALTER TABLE users
ADD CONSTRAINT active_user_requires_verification CHECK (
    status <> 'active'
    OR (
        email_verified_at IS NOT NULL
        AND phone_verified_at IS NOT NULL
    )
);

ALTER TABLE users DROP COLUMN verification_policy;
