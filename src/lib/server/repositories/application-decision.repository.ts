import "server-only";
import type { PoolClient } from "pg";
import type { ApplicationReviewData } from "@/lib/validation/application-review";

export async function lockReviewingAdmin(
  client: PoolClient,
  adminId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT u.id
     FROM users u
     JOIN platform_admins pa ON pa.user_id = u.id
     WHERE u.id = $1
       AND u.status = 'active'
       AND u.email_verified_at IS NOT NULL
       AND u.phone_verified_at IS NOT NULL
     FOR SHARE OF u, pa`,
    [adminId],
  );

  return result.rows.length === 1;
}

type LockedApplication = {
  id: string;
  status: string;
  revision: number;
  snapshot: Record<string, unknown> | null;
};

export async function lockApplicationForDecision(
  client: PoolClient,
  applicationId: string,
): Promise<LockedApplication | null> {
  const result = await client.query<LockedApplication>(
    `SELECT a.id, a.status, a.revision,
       (
         SELECT e.application_snapshot
         FROM application_events e
         WHERE e.application_id = a.id
           AND e.application_revision = a.revision
           AND e.action IN ('submitted', 'resubmitted')
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT 1
       ) AS snapshot
     FROM society_applications a
     WHERE a.id = $1
     FOR UPDATE OF a`,
    [applicationId],
  );

  return result.rows[0] ?? null;
}

export async function saveApplicationDecision(
  client: PoolClient,
  applicationId: string,
  adminId: string,
  revision: number,
  data: ApplicationReviewData,
  snapshot: Record<string, unknown>,
): Promise<Date> {
  const note = data.note || null;

  const result = await client.query<{
    reviewedAt: Date;
    societyId: string;
    applicantUserId: string;
  }>(
    `UPDATE society_applications
     SET status = $2,
         reviewed_by = $3,
         reviewed_at = clock_timestamp(),
         review_note = $4,
         updated_at = clock_timestamp()
     WHERE id = $1
     RETURNING
       reviewed_at AS "reviewedAt",
       society_id AS "societyId",
       applicant_user_id AS "applicantUserId"`,
    [applicationId, data.decision, adminId, note],
  );

  const application = result.rows[0];

  if (!application) {
    throw new Error("Application decision could not be saved.");
  }

  let membershipStatus: "active" | "revoked" | null = null;

  if (data.decision === "approved") {
    membershipStatus = "active";
  } else if (data.decision === "rejected") {
    membershipStatus = "revoked";
  }

  if (membershipStatus !== null) {
    const membership = await client.query(
      `UPDATE society_memberships
       SET status = $3,
           updated_at = clock_timestamp()
       WHERE society_id = $1
         AND user_id = $2
         AND role = 'chairman'
         AND status = 'pending'`,
      [
        application.societyId,
        application.applicantUserId,
        membershipStatus,
      ],
    );

    if (membership.rowCount !== 1) {
      throw new Error(
        "The application's pending chairman membership is missing.",
      );
    }
  }

  // Approval grants the chairman role. It does not activate a
  // subscription or change societies.service_status.
  await client.query(
    `INSERT INTO application_events (
       application_id, actor_user_id, action,
       application_revision, note, application_snapshot
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      applicationId,
      adminId,
      data.decision,
      revision,
      note,
      JSON.stringify({
        ...snapshot,
        review: {
          previousStatus: data.expectedStatus,
          newStatus: data.decision,
          note,
          adminUserId: adminId,
          chairmanMembershipStatus: membershipStatus ?? "pending",
        },
      }),
    ],
  );

  return application.reviewedAt;
}
