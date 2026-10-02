import "server-only";
import type { PoolClient } from "pg";
import { getDatabase } from "@/lib/server/db";
import type {
  ResidentDashboardData,
  ResidentHome,
  ResidentDashboardApplication,
} from "@/lib/contracts/resident-dashboard";

// userId must come from the authenticated session, never request parameters.
export async function loadResidentDashboard(
  userId: string,
  database: Pick<PoolClient, "query"> = getDatabase(),
): Promise<ResidentDashboardData> {
  const homes = await database.query<ResidentHome>(
    `SELECT u.id AS "unitId", s.id AS "societyId",
            s.name AS "societyName", s.city,
            u.wing, u.floor_label AS floor,
            u.flat_number AS "flatNumber",
            m.relationship, m.source_request_id AS "sourceRequestId",
            m.move_in_date::text AS "moveInDate", m.tenancy_end_date::text AS "tenancyEndDate",
            CASE WHEN m.relationship='tenant' AND m.move_in_date >
              (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'upcoming' ELSE 'active' END AS "accessState"
     FROM resident_unit_memberships m
     JOIN resident_unit_requests r
       ON r.id = m.source_request_id
       AND r.user_id = m.user_id AND r.unit_id = m.unit_id
       AND r.society_id = m.society_id
       AND r.relationship = m.relationship
     JOIN society_units u ON u.id = m.unit_id AND u.society_id = m.society_id
     JOIN societies s ON s.id = m.society_id
     WHERE m.user_id = $1 AND m.status = 'active'
       AND r.status = 'approved'
       AND s.service_status IN ('active', 'inactive')
       AND EXISTS (
         SELECT 1 FROM society_applications a
         WHERE a.society_id = s.id AND a.status = 'approved'
       )
       AND (
         m.relationship = 'owner'
         OR (
           (m.tenancy_end_date IS NULL OR
             m.tenancy_end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
         )
       )
     ORDER BY s.name, u.wing, u.flat_number, u.id`,
    [userId],
  );

  const totals = await database.query<{ status: string; count: number }>(
    `SELECT status, count(*)::integer AS count
     FROM resident_unit_requests
     WHERE user_id = $1 AND deleted_at IS NULL GROUP BY status`,
    [userId],
  );

  const applications = await database.query<ResidentDashboardApplication>(
    `SELECT r.id, s.name AS "societyName", u.wing,
            u.flat_number AS "flatNumber", r.relationship,
            r.status, r.review_note AS "reviewNote"
     FROM resident_unit_requests r
     JOIN societies s ON s.id = r.society_id
     JOIN society_units u ON u.id = r.unit_id AND u.society_id = r.society_id
     WHERE r.user_id = $1 AND r.deleted_at IS NULL
     ORDER BY CASE r.status
       WHEN 'changes_requested' THEN 0
       WHEN 'draft' THEN 1
       WHEN 'pending' THEN 2
       ELSE 3 END,
       r.updated_at DESC, r.id DESC
     LIMIT 6`,
    [userId],
  );

  const counts: Record<string, number> = {
    draft: 0, pending: 0, changes_requested: 0,
    approved: 0, rejected: 0, withdrawn: 0,
  };
  for (const row of totals.rows) counts[row.status] = row.count;

  const account = await database.query<{ preferredName: string | null }>(
    `SELECT preferred_name AS "preferredName" FROM users WHERE id=$1`, [userId],
  );
  return {
    homes: homes.rows, counts, applications: applications.rows,
    preferredName: account.rows[0]?.preferredName ?? null,
  };
}
