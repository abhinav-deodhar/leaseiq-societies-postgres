-- Up Migration

ALTER TABLE users
ADD COLUMN date_of_birth DATE;

ALTER TABLE users
ADD CONSTRAINT valid_user_date_of_birth CHECK (
    date_of_birth IS NULL
    OR (
        isfinite(date_of_birth)
        AND date_of_birth >= DATE '0001-01-01'
        AND date_of_birth <= (
            CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
        )::date
    )
);

-- Down Migration

ALTER TABLE users DROP CONSTRAINT valid_user_date_of_birth;
ALTER TABLE users DROP COLUMN date_of_birth;