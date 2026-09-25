-- Up Migration

-- Reconcile only memberships still awaiting their application's
-- decision. Do not restore memberships that were explicitly revoked.
UPDATE society_memberships AS membership
SET status = CASE
        WHEN application.status = 'approved' THEN 'active'
        ELSE 'revoked'
    END,
    updated_at = clock_timestamp()
FROM society_applications AS application
WHERE membership.society_id = application.society_id
  AND membership.user_id = application.applicant_user_id
  AND membership.role = 'chairman'
  AND membership.status = 'pending'
  AND application.status IN ('approved', 'rejected');

-- Deliberately leave societies.service_status unchanged.

-- Down Migration

-- This data reconciliation is not automatically reversed:
-- subsequent legitimate membership changes must not be overwritten.
SELECT 1;
