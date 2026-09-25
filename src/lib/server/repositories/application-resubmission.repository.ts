import "server-only";
import type { PoolClient } from "pg";
import type { SocietyApplicationData } from "@/lib/validation/society";
import type { ApplicantRecord } from "./society-application.repository";

type LockedApplication = {
  id: string;
  societyId: string;
  status: string;
  revision: number;
  reviewNote: string | null;
};

export async function lockOwnedApplication(
  client: PoolClient,
  applicationId: string,
  userId: string,
): Promise<LockedApplication | null> {
  const result = await client.query<LockedApplication>(
    `SELECT
       id,
       society_id AS "societyId",
       status,
       revision,
       review_note AS "reviewNote"
     FROM society_applications
     WHERE id = $1
       AND applicant_user_id = $2
     FOR UPDATE`,
    [applicationId, userId],
  );

  return result.rows[0] ?? null;
}

export async function updateApplicationSociety(
  client: PoolClient,
  societyId: string,
  data: SocietyApplicationData,
): Promise<void> {
  const result = await client.query(
    `UPDATE societies
     SET
       name = $2,
       address_line_1 = $3,
       address_line_2 = $4,
       city = $5,
       state_or_union_territory = $6,
       pin_code = $7,
       wing_count = $8,
       total_units = $9,
       studio_units = $10,
       one_bhk_units = $11,
       two_bhk_units = $12,
       three_bhk_units = $13,
       four_plus_bhk_units = $14,
       other_residential_units = $15,
       other_residential_description = $16,
       residential_layout = $17::jsonb,
       updated_at = clock_timestamp()
     WHERE id = $1`,
    [
      societyId,
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
      data.residentialLayout ? JSON.stringify(data.residentialLayout) : null,
    ],
  );

  if (result.rowCount !== 1) {
    throw new Error("Application society was not found.");
  }
}

export async function markApplicationResubmitted(
  client: PoolClient,
  applicationId: string,
  expectedRevision: number,
): Promise<{ revision: number; submittedAt: Date }> {
  const result = await client.query<{
    revision: number;
    submittedAt: Date;
  }>(
    `UPDATE society_applications
     SET
       status = 'pending_review',
       revision = revision + 1,
       submitted_at = clock_timestamp(),
       reviewed_at = NULL,
       reviewed_by = NULL,
       review_note = NULL,
       updated_at = clock_timestamp()
     WHERE id = $1
       AND revision = $2
       AND status = 'changes_requested'
     RETURNING revision, submitted_at AS "submittedAt"`,
    [applicationId, expectedRevision],
  );

  const application = result.rows[0];

  if (!application) {
    throw new Error("Application changed during resubmission.");
  }

  return application;
}

export async function insertResubmissionEvent(
  client: PoolClient,
  input: {
    applicationId: string;
    userId: string;
    revision: number;
    previousReviewNote: string | null;
    society: SocietyApplicationData;
    applicant: ApplicantRecord;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO application_events (
       application_id,
       actor_user_id,
       action,
       application_revision,
       application_snapshot
     )
     VALUES ($1, $2, 'resubmitted', $3, $4::jsonb)`,
    [
      input.applicationId,
      input.userId,
      input.revision,
      JSON.stringify({
        society: input.society,
        applicant: {
          userId: input.userId,
          ...input.applicant,
        },
        resubmission: {
          previousRevision: input.revision - 1,
          previousStatus: "changes_requested",
          previousReviewNote: input.previousReviewNote,
        },
      }),
    ],
  );
}