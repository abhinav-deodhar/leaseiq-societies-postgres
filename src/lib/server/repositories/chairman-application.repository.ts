import "server-only";
import { getDatabase } from "@/lib/server/db";
import type { SocietyApplicationData } from "@/lib/validation/society";

export type ChairmanApplicationRecord = SocietyApplicationData & {
  id: string;
  societyId: string;
  status:
    | "draft"
    | "pending_review"
    | "changes_requested"
    | "approved"
    | "rejected";
  serviceStatus: "inactive" | "active" | "suspended";
  revision: number;
  submittedAt: Date | null;
  reviewNote: string | null;
};

export async function findChairmanApplication(
  authenticatedUserId: string,
): Promise<ChairmanApplicationRecord | null> {
  const result = await getDatabase().query<ChairmanApplicationRecord>(
    `SELECT
       a.id,
       a.society_id AS "societyId",
       a.status,
       a.revision,
       a.submitted_at AS "submittedAt",
       a.review_note AS "reviewNote",
       s.service_status AS "serviceStatus",
       s.residential_layout AS "residentialLayout",
       s.name,
       s.address_line_1 AS "addressLine1",
       s.address_line_2 AS "addressLine2",
       s.city,
       s.state_or_union_territory AS state,
       s.pin_code AS "pinCode",
       s.wing_count AS "wingCount",
       s.total_units AS "totalUnits",
       s.studio_units AS "studioUnits",
       s.one_bhk_units AS "oneBhkUnits",
       s.two_bhk_units AS "twoBhkUnits",
       s.three_bhk_units AS "threeBhkUnits",
       s.four_plus_bhk_units AS "fourPlusBhkUnits",
       s.other_residential_units AS "otherResidentialUnits",
       s.other_residential_description AS "otherResidentialDescription"
     FROM society_applications a
     JOIN societies s ON s.id = a.society_id
     WHERE a.applicant_user_id = $1
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 1`,
    [authenticatedUserId],
  );

  return result.rows[0] ?? null;
}