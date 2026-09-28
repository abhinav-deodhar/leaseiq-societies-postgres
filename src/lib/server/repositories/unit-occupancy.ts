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

// Detailed labels do not change ownership or grant resident access.
// Resolve explicit reports only while their exact owner membership is active.
export const effectiveUnitOccupancyBadgeSql = `
  CASE
    WHEN EXISTS (
      SELECT 1 FROM resident_unit_memberships tenant_member
      JOIN resident_unit_requests tenant_request ON tenant_request.id=tenant_member.source_request_id
        AND tenant_request.society_id=tenant_member.society_id
        AND tenant_request.unit_id=tenant_member.unit_id
        AND tenant_request.user_id=tenant_member.user_id
      WHERE tenant_member.unit_id=u.id AND tenant_member.society_id=u.society_id
        AND tenant_member.relationship='tenant' AND tenant_member.status='active'
        AND tenant_request.relationship='tenant' AND tenant_request.status='approved'
        AND tenant_request.owner_review_status='approved'
        AND (tenant_member.move_in_date IS NULL OR tenant_member.move_in_date <= (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date)
        AND (tenant_member.tenancy_end_date IS NULL OR tenant_member.tenancy_end_date >= (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date)
    ) THEN 'CR'
    WHEN (${effectiveUnitOccupancySql}) = 'owner_occupied' THEN 'OO'
    ELSE COALESCE(
      (SELECT u.owner_occupancy_report FROM resident_unit_memberships reporter
       JOIN resident_unit_requests source ON source.id=reporter.source_request_id
         AND source.society_id=reporter.society_id AND source.unit_id=reporter.unit_id
         AND source.user_id=reporter.user_id AND source.relationship='owner'
       WHERE reporter.id=u.occupancy_report_membership_id
         AND reporter.unit_id=u.id AND reporter.society_id=u.society_id
         AND reporter.relationship='owner' AND reporter.status='active' AND source.status='approved'),
      (SELECT source.applicant_profile->>'occupancyWhenAway'
       FROM resident_unit_memberships owner_member
       JOIN resident_unit_requests source ON source.id=owner_member.source_request_id
         AND source.society_id=owner_member.society_id AND source.unit_id=owner_member.unit_id
         AND source.user_id=owner_member.user_id AND source.relationship='owner'
       WHERE owner_member.unit_id=u.id AND owner_member.society_id=u.society_id
         AND owner_member.relationship='owner' AND owner_member.status='active'
         AND source.status='approved'
         AND source.applicant_profile->'residesInFlat'='false'::jsonb
         AND source.applicant_profile->>'occupancyWhenAway' IN ('VARR','VNRR','UM','CR','FO')
       ORDER BY owner_member.approved_at DESC, owner_member.id LIMIT 1),
      CASE u.occupancy_status WHEN 'rented' THEN 'CR' WHEN 'vacant' THEN 'V' ELSE 'UNK' END
    )
  END
`;
