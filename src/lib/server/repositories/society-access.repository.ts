import "server-only";
import type { PoolClient } from "pg";

export type ChairmanSetupAccess = {
  societyId: string;
  societyName: string;
  membershipId: string;
  serviceStatus: "inactive" | "active";
};

// Call inside a transaction. Shared locks keep the relevant access
// records stable until the protected operation commits or rolls back.
export async function lockChairmanSetupAccess(
  client: PoolClient,
  userId: string,
  societyId: string,
): Promise<ChairmanSetupAccess | null> {
  const result = await client.query<ChairmanSetupAccess>(
    `SELECT
       s.id AS "societyId",
       s.name AS "societyName",
       m.id AS "membershipId",
       s.service_status AS "serviceStatus"
     FROM society_memberships m
     JOIN users u ON u.id = m.user_id
     JOIN societies s ON s.id = m.society_id
     JOIN society_applications a ON a.society_id = s.id
     WHERE m.user_id = $1
       AND m.society_id = $2
       AND m.role = 'chairman'
       AND m.status = 'active'
       AND u.status = 'active'
       AND u.email_verified_at IS NOT NULL
       AND (
         u.phone_verified_at IS NOT NULL
         OR (
           u.verification_policy = 'email_only'
           AND NOT EXISTS (
             SELECT 1 FROM platform_admins verification_admin
             WHERE verification_admin.user_id = u.id
           )
         )
       )
       AND a.status = 'approved'
       AND s.service_status IN ('inactive', 'active')
       AND NOT EXISTS (
         SELECT 1
         FROM platform_admins pa
         WHERE pa.user_id = u.id
       )
     FOR SHARE OF u, m, s, a`,
    [userId, societyId],
  );

  return result.rows[0] ?? null;
}
