import "server-only";

// Static SQL fragment. The outer society_units table must use alias u.
// Existing recorded rental occupancy takes precedence over owner residence.
export const effectiveUnitOccupancySql = `
  CASE
    WHEN u.occupancy_status = 'rented' THEN 'rented'
    WHEN EXISTS (
      SELECT 1
      FROM resident_unit_memberships occupancy_membership
      JOIN resident_unit_requests occupancy_request
        ON occupancy_request.id = occupancy_membership.source_request_id
       AND occupancy_request.society_id = occupancy_membership.society_id
       AND occupancy_request.unit_id = occupancy_membership.unit_id
       AND occupancy_request.user_id = occupancy_membership.user_id
       AND occupancy_request.relationship = occupancy_membership.relationship
      WHERE occupancy_membership.society_id = u.society_id
        AND occupancy_membership.unit_id = u.id
        AND occupancy_membership.status = 'active'
        AND occupancy_membership.relationship = 'owner'
        AND occupancy_request.status = 'approved'
        AND occupancy_request.applicant_profile -> 'residesInFlat' = 'true'::jsonb
        AND (
          occupancy_membership.move_in_date IS NULL
          OR occupancy_membership.move_in_date <=
             (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
        )
    ) THEN 'owner_occupied'
    ELSE u.occupancy_status
  END
`;
