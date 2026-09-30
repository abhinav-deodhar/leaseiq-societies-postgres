-- Up Migration
ALTER TABLE resident_unit_requests ADD COLUMN deleted_at timestamptz;
ALTER TABLE resident_unit_requests ADD CONSTRAINT deleted_draft_only
 CHECK (deleted_at IS NULL OR (status='withdrawn' AND submitted_at IS NULL));
-- Down Migration
ALTER TABLE resident_unit_requests DROP CONSTRAINT deleted_draft_only;
ALTER TABLE resident_unit_requests DROP COLUMN deleted_at;
