-- Up Migration
ALTER TABLE users
  ADD COLUMN primary_correspondence_address JSONB,
  ADD COLUMN correspondence_revision INTEGER NOT NULL DEFAULT 0
    CHECK (correspondence_revision >= 0),
  ADD CONSTRAINT users_primary_correspondence_object CHECK (
    primary_correspondence_address IS NULL OR (
      jsonb_typeof(primary_correspondence_address) = 'object'
      AND octet_length(primary_correspondence_address::text) <= 8192
    )
  );

-- Existing application snapshots are deliberately not migrated or changed.

-- Down Migration
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users WHERE primary_correspondence_address IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account addresses exist. Export them before removing this feature.';
  END IF;
END $$;
ALTER TABLE users
  DROP CONSTRAINT users_primary_correspondence_object,
  DROP COLUMN primary_correspondence_address,
  DROP COLUMN correspondence_revision;
