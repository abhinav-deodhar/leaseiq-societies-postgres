-- Up Migration
ALTER TABLE society_units
  ADD COLUMN owner_occupancy_report TEXT
    CHECK (owner_occupancy_report IN ('VARR','VNRR','UM','CR','FO')),
  ADD COLUMN occupancy_report_membership_id UUID,
  ADD COLUMN occupancy_reported_at TIMESTAMPTZ,
  ADD CONSTRAINT society_units_occupancy_report_complete CHECK (
    (owner_occupancy_report IS NULL AND occupancy_report_membership_id IS NULL AND occupancy_reported_at IS NULL)
    OR (owner_occupancy_report IS NOT NULL AND occupancy_report_membership_id IS NOT NULL AND occupancy_reported_at IS NOT NULL)
  );
-- Membership provenance is resolved against active approved ownership at read
-- time. It is intentionally not a circular FK back into resident memberships.

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: preserve owner occupancy reports and audit history.'; END $$;
