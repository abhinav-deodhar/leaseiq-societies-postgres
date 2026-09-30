-- Up Migration
ALTER TABLE resident_unit_request_events
  DROP CONSTRAINT resident_unit_request_events_action_check;
ALTER TABLE resident_unit_request_events
  ADD CONSTRAINT resident_unit_request_events_action_check CHECK (action IN (
    'created','updated','submitted','approved','rejected','withdrawn',
    'membership_revoked','changes_requested','resubmitted',
    'owner_verified','owner_rejected','owner_changes_requested'
  ));
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: retain tenant review audit history.'; END $$;
