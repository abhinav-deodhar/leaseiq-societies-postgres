-- Up Migration

ALTER TABLE resident_unit_requests
  DROP CONSTRAINT resident_unit_requests_status_check,
  DROP CONSTRAINT resident_requests_submission_consistent,
  DROP CONSTRAINT resident_requests_review_consistent,
  DROP CONSTRAINT resident_requests_rejection_reason;

ALTER TABLE resident_unit_requests
  ADD CONSTRAINT resident_unit_requests_status_check
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'withdrawn', 'changes_requested')),
  ADD CONSTRAINT resident_requests_submission_consistent CHECK (
    (status = 'draft' AND submitted_at IS NULL)
    OR (status IN ('pending', 'approved', 'rejected', 'changes_requested') AND submitted_at IS NOT NULL)
    OR status = 'withdrawn'
  ),
  ADD CONSTRAINT resident_requests_review_consistent CHECK (
    (
      status IN ('approved', 'rejected', 'changes_requested')
      AND reviewed_at IS NOT NULL
      AND reviewed_by IS NOT NULL
      AND submitted_at IS NOT NULL
      AND reviewed_at >= submitted_at
    )
    OR (
      status IN ('draft', 'pending', 'withdrawn')
      AND reviewed_at IS NULL
      AND reviewed_by IS NULL
      AND review_note IS NULL
    )
  ),
  ADD CONSTRAINT resident_requests_rejection_reason CHECK (
    status NOT IN ('rejected', 'changes_requested') OR review_note IS NOT NULL
  );

DROP INDEX resident_requests_one_open_per_flat;
CREATE UNIQUE INDEX resident_requests_one_open_per_flat
  ON resident_unit_requests(user_id, unit_id)
  WHERE status IN ('draft', 'pending', 'changes_requested');

ALTER TABLE resident_unit_request_events
  DROP CONSTRAINT resident_unit_request_events_action_check;
ALTER TABLE resident_unit_request_events
  ADD CONSTRAINT resident_unit_request_events_action_check
    CHECK (action IN ('created', 'updated', 'submitted', 'approved', 'rejected', 'withdrawn', 'membership_revoked', 'changes_requested', 'resubmitted'));

-- Down Migration
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM resident_unit_requests WHERE status = 'changes_requested'
  ) OR EXISTS (
    SELECT 1 FROM resident_unit_request_events
    WHERE action IN ('changes_requested', 'resubmitted')
  ) THEN
    RAISE EXCEPTION 'Cannot downgrade while correction workflow records exist.';
  END IF;
END $$;

ALTER TABLE resident_unit_requests
  DROP CONSTRAINT resident_unit_requests_status_check,
  DROP CONSTRAINT resident_requests_submission_consistent,
  DROP CONSTRAINT resident_requests_review_consistent,
  DROP CONSTRAINT resident_requests_rejection_reason;

ALTER TABLE resident_unit_requests
  ADD CONSTRAINT resident_unit_requests_status_check
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'withdrawn')),
  ADD CONSTRAINT resident_requests_submission_consistent CHECK (
    (status = 'draft' AND submitted_at IS NULL)
    OR (status IN ('pending', 'approved', 'rejected') AND submitted_at IS NOT NULL)
    OR status = 'withdrawn'
  ),
  ADD CONSTRAINT resident_requests_review_consistent CHECK (
    (
      status IN ('approved', 'rejected')
      AND reviewed_at IS NOT NULL
      AND reviewed_by IS NOT NULL
      AND submitted_at IS NOT NULL
      AND reviewed_at >= submitted_at
    )
    OR (
      status IN ('draft', 'pending', 'withdrawn')
      AND reviewed_at IS NULL
      AND reviewed_by IS NULL
      AND review_note IS NULL
    )
  ),
  ADD CONSTRAINT resident_requests_rejection_reason CHECK (
    status NOT IN ('rejected') OR review_note IS NOT NULL
  );

DROP INDEX resident_requests_one_open_per_flat;
CREATE UNIQUE INDEX resident_requests_one_open_per_flat
  ON resident_unit_requests(user_id, unit_id)
  WHERE status IN ('draft', 'pending');

ALTER TABLE resident_unit_request_events
  DROP CONSTRAINT resident_unit_request_events_action_check;
ALTER TABLE resident_unit_request_events
  ADD CONSTRAINT resident_unit_request_events_action_check
    CHECK (action IN ('created', 'updated', 'submitted', 'approved', 'rejected', 'withdrawn', 'membership_revoked'));
