import "server-only";
import type { ResidentialLayoutInput } from "@/lib/validation/residential-layout";
import { getDatabase } from "@/lib/server/db";

export type ApplicationDetailRecord = {
  id: string;
  status:
    | "draft"
    | "pending_review"
    | "changes_requested"
    | "approved"
    | "rejected";
  revision: number;
  submittedAt: Date | null;
  reviewNote: string | null;
  societyName: string;
  residentialLayout: ResidentialLayoutInput | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pinCode: string;
  wingCount: number;
  totalUnits: number;
  studioUnits: number;
  oneBhkUnits: number;
  twoBhkUnits: number;
  threeBhkUnits: number;
  fourPlusBhkUnits: number;
  otherResidentialUnits: number;
  otherResidentialDescription: string | null;
  chairmanName: string;
  chairmanEmail: string;
  chairmanPhone: string;
};

export async function findApplicationForAdmin(
  adminUserId: string,
  applicationId: string,
): Promise<ApplicationDetailRecord | null> {
  const result = await getDatabase().query<ApplicationDetailRecord>(
    `SELECT
       a.id,
       a.status,
       a.revision,
       a.submitted_at AS "submittedAt",
       a.review_note AS "reviewNote",
       s.name AS "societyName",
       s.residential_layout AS "residentialLayout",
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
       s.other_residential_description AS "otherResidentialDescription",
       u.full_name AS "chairmanName",
       u.email AS "chairmanEmail",
       u.phone AS "chairmanPhone"
     FROM society_applications a
     JOIN societies s ON s.id = a.society_id
     JOIN users u ON u.id = a.applicant_user_id
     WHERE a.id = $1
       AND EXISTS (
         SELECT 1
         FROM platform_admins pa
         JOIN users admin_user ON admin_user.id = pa.user_id
         WHERE pa.user_id = $2
           AND admin_user.status = 'active'
           AND admin_user.email_verified_at IS NOT NULL
           AND admin_user.phone_verified_at IS NOT NULL
       )`,
    [applicationId, adminUserId],
  );

  return result.rows[0] ?? null;
}