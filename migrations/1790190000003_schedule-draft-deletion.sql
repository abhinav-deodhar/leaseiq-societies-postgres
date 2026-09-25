-- Up Migration
ALTER TABLE invoice_schedules ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE invoice_schedules ADD CONSTRAINT deleted_schedule_is_draft CHECK (deleted_at IS NULL OR status = 'draft');
-- Down Migration
ALTER TABLE invoice_schedules DROP CONSTRAINT deleted_schedule_is_draft;
ALTER TABLE invoice_schedules DROP COLUMN deleted_at;
