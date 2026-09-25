import "server-only";
import { getDatabase } from "@/lib/server/db";
import type {
  ApplicationListQuery,
  ApplicationSummary,
} from "@/lib/contracts/application-list";

export const APPLICATION_PAGE_SIZE = 50;

type ApplicationListRow = Omit<ApplicationSummary, "submittedAt"> & {
  submittedAt: Date;
};

export async function findApplicationsForAdmin(
  adminId: string,
  query: ApplicationListQuery,
): Promise<ApplicationListRow[]> {
  const result = await getDatabase().query<ApplicationListRow>(
    `SELECT
       a.id,
       a.status,
       a.submitted_at AS "submittedAt",
       s.name AS "societyName",
       s.city,
       s.state_or_union_territory AS state,
       s.total_units AS "totalUnits",
       u.full_name AS "chairmanName",
       u.email AS "chairmanEmail",
       u.phone AS "chairmanPhone"
     FROM society_applications a
     JOIN societies s ON s.id = a.society_id
     JOIN users u ON u.id = a.applicant_user_id
     WHERE a.status IN (
       'pending_review', 'changes_requested', 'approved', 'rejected'
     )
       AND ($1::text = 'all' OR a.status = $1)
       AND EXISTS (
         SELECT 1
         FROM platform_admins pa
         JOIN users admin_user ON admin_user.id = pa.user_id
         WHERE pa.user_id = $2
           AND admin_user.status = 'active'
           AND admin_user.email_verified_at IS NOT NULL
           AND admin_user.phone_verified_at IS NOT NULL
       )
     ORDER BY a.submitted_at ASC, a.id ASC
     LIMIT $3 OFFSET $4`,
    [
      query.status,
      adminId,
      APPLICATION_PAGE_SIZE + 1,
      (query.page - 1) * APPLICATION_PAGE_SIZE,
    ],
  );

  return result.rows;
}