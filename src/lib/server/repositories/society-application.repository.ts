import "server-only";
import type { PoolClient } from "pg";
import type { SocietyApplicationData } from "@/lib/validation/society";

export type ApplicantRecord = {
  fullName: string;
  email: string;
  phone: string;
};

export async function lockEligibleApplicant(
  client: PoolClient,
  userId: string,
): Promise<ApplicantRecord | null> {
  const result = await client.query<ApplicantRecord>(
    `SELECT
       u.full_name AS "fullName",
       u.email,
       u.phone
     FROM users u
     WHERE u.id = $1
       AND u.status = 'active'
       AND u.email_verified_at IS NOT NULL
       AND u.phone_verified_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM platform_admins a WHERE a.user_id = u.id
       )
     FOR UPDATE OF u`,
    [userId],
  );

  return result.rows[0] ?? null;
}

export async function applicantHasApplication(
  client: PoolClient,
  userId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT id
     FROM society_applications
     WHERE applicant_user_id = $1
     LIMIT 1`,
    [userId],
  );

  return result.rows.length > 0;
}

export async function insertSociety(
  client: PoolClient,
  userId: string,
  data: SocietyApplicationData,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO societies (
       name, address_line_1, address_line_2, city,
       state_or_union_territory, pin_code, wing_count,
       total_units, studio_units, one_bhk_units,
       two_bhk_units, three_bhk_units, four_plus_bhk_units,
       other_residential_units, other_residential_description,
       created_by, residential_layout
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
     )
     RETURNING id`,
    [
      data.name,
      data.addressLine1,
      data.addressLine2,
      data.city,
      data.state,
      data.pinCode,
      data.wingCount,
      data.totalUnits,
      data.studioUnits,
      data.oneBhkUnits,
      data.twoBhkUnits,
      data.threeBhkUnits,
      data.fourPlusBhkUnits,
      data.otherResidentialUnits,
      data.otherResidentialDescription,
      userId,
      data.residentialLayout ? JSON.stringify(data.residentialLayout) : null,
    ],
  );

  return result.rows[0].id;
}

export async function insertPendingChairmanMembership(
  client: PoolClient,
  societyId: string,
  userId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO society_memberships (
       society_id, user_id, role, status
     )
     VALUES ($1, $2, 'chairman', 'pending')`,
    [societyId, userId],
  );
}

export async function insertPendingApplication(
  client: PoolClient,
  societyId: string,
  userId: string,
): Promise<{ id: string; submittedAt: Date }> {
  const result = await client.query<{
    id: string;
    submittedAt: Date;
  }>(
    `INSERT INTO society_applications (
       society_id, applicant_user_id, status, submitted_at
     )
     VALUES ($1, $2, 'pending_review', clock_timestamp())
     RETURNING id, submitted_at AS "submittedAt"`,
    [societyId, userId],
  );

  return result.rows[0];
}

export async function insertSubmissionEvent(
  client: PoolClient,
  applicationId: string,
  userId: string,
  society: SocietyApplicationData,
  applicant: ApplicantRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO application_events (
       application_id, actor_user_id, action,
       application_revision, application_snapshot
     )
     VALUES ($1, $2, 'submitted', 1, $3::jsonb)`,
    [
      applicationId,
      userId,
      JSON.stringify({
        society,
        applicant: { userId, ...applicant },
      }),
    ],
  );
}