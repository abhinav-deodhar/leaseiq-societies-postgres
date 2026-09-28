-- Up Migration
CREATE TABLE unit_deletion_previews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id),
    actor_user_id UUID NOT NULL REFERENCES users(id),
    target JSONB NOT NULL CHECK (jsonb_typeof(target) = 'object'),
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + interval '10 minutes',
    consumed_at TIMESTAMPTZ
);
CREATE INDEX unit_deletion_previews_expiry_idx ON unit_deletion_previews(expires_at);

-- The original unit ID deliberately has no FK to the live register.
-- Its full row and ordered audit events survive removal from that register.
CREATE TABLE deleted_unit_history (
    unit_id UUID PRIMARY KEY,
    society_id UUID NOT NULL REFERENCES societies(id),
    deleted_by UUID NOT NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    unit_snapshot JSONB NOT NULL CHECK (jsonb_typeof(unit_snapshot) = 'object'),
    event_history JSONB NOT NULL CHECK (jsonb_typeof(event_history) = 'array')
);
CREATE INDEX deleted_unit_history_society_idx
    ON deleted_unit_history(society_id, deleted_at, unit_id);

-- Down Migration
DO $$ BEGIN
  RAISE EXCEPTION 'Forward-only migration: preserve deleted unit audit history.';
END $$;
