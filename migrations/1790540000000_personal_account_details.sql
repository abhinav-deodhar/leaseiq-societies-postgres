-- Up Migration
ALTER TABLE users
 ADD COLUMN preferred_name TEXT CHECK (
   preferred_name IS NULL OR (
     preferred_name = btrim(preferred_name)
     AND char_length(preferred_name) BETWEEN 1 AND 80
   )
 ),
 ADD COLUMN personal_details_revision INTEGER NOT NULL DEFAULT 0
 CHECK (personal_details_revision >= 0);

CREATE TABLE personal_details_auth_attempts (
 user_id UUID PRIMARY KEY REFERENCES users(id),
 window_start TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0)
);

CREATE TABLE personal_details_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id),
 revision INTEGER NOT NULL CHECK (revision > 0),
 changed_fields TEXT[] NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (user_id, revision),
 CHECK (
   cardinality(changed_fields) > 0
   AND changed_fields <@ ARRAY['fullName','dateOfBirth','preferredName']::text[]
 )
);

-- Down Migration
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM personal_details_events) THEN
   RAISE EXCEPTION 'Personal-details history exists. Review before downgrading.';
 END IF;
END $$;

DROP TABLE personal_details_events;
DROP TABLE personal_details_auth_attempts;
ALTER TABLE users
 DROP COLUMN preferred_name,
 DROP COLUMN personal_details_revision;
