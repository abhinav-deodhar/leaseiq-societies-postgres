import "server-only";
import {
  correspondenceAddressSchema,
  type PrimaryAddress,
} from "@/lib/contracts/primary-address";
import {
  residentApplicationProfileSchema,
  type ResidentProfile,
} from "@/lib/contracts/resident-profile";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  residentRequestSchema,
  residentRequestSubmissionSchema,
  type ResidentRequestData,
} from "@/lib/contracts/resident-associations";
import { getDatabase } from "@/lib/server/db";
import { lockSocietyUnitManagement } from "@/lib/server/repositories/unit-capacity.repository";

export class ResidentRequestError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "ALREADY_ASSOCIATED"
      | "REQUEST_EXISTS"
      | "REVISION_CONFLICT"
      | "NOT_EDITABLE",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ResidentRequestError";
  }
}

export type ResidentRequestRecord = {
  id: string;
  societyId: string;
  unitId: string;
  relationship: "owner" | "tenant";
  status: "draft" | "pending" | "changes_requested" | "approved" | "rejected" | "withdrawn";
  moveInDate: string | null;
  tenancyEndDate: string | null;
  applicantNote: string | null;
  revision: number;
  applicantProfile: ResidentProfile | null;
};

const returnedColumns = `
  id,
  society_id AS "societyId",
  unit_id AS "unitId",
  relationship,
  status,
  move_in_date::text AS "moveInDate",
  tenancy_end_date::text AS "tenancyEndDate",
  applicant_note AS "applicantNote",
  applicant_profile AS "applicantProfile",
  revision
`;

function requireUuid(value: string): void {
  if (!z.uuid().safeParse(value).success) {
    throw new ResidentRequestError(
      "INVALID_INPUT",
      "Choose a valid society, flat or request.",
      400,
    );
  }
}

function parseRequest(input: unknown): ResidentRequestData {
  const parsed = residentRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ResidentRequestError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Check the request details.",
      400,
    );
  }
  return parsed.data;
}

function parseProfile(
  relationship: "owner" | "tenant",
  input: unknown,
): ResidentProfile | undefined {
  // Older clients may save a basic draft without a completed profile.
  if (input === undefined) return undefined;
  const parsed = residentApplicationProfileSchema.safeParse({
    relationship, profile: input,
  });
  if (!parsed.success) {
    throw new ResidentRequestError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Check your personal details.",
      400,
    );
  }
  if (Buffer.byteLength(JSON.stringify(parsed.data.profile), "utf8") > 24000) {
    throw new ResidentRequestError(
      "INVALID_INPUT", "Your household details are too long.", 400,
    );
  }
  return parsed.data.profile;
}

export async function withResidentRequestAccess<T>(
  userId: string,
  societyId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  requireUuid(userId);
  requireUuid(societyId);

  const client = await getDatabase().connect();
  let begun = false;
  let discard = false;

  try {
    await client.query("BEGIN");
    begun = true;

    // Same society lock order as chairman unit operations.
    await lockSocietyUnitManagement(client, societyId);

    const account = await client.query(
      `SELECT u.id
       FROM users u
       WHERE u.id = $1
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
         AND NOT EXISTS (
           SELECT 1 FROM platform_admins p WHERE p.user_id = u.id
         )
       FOR SHARE OF u`,
      [userId],
    );

    if (account.rowCount !== 1) {
      throw new ResidentRequestError(
        "FORBIDDEN",
        "Sign in with a verified resident account.",
        403,
      );
    }

    const society = await client.query(
      `SELECT s.id
       FROM societies s
       JOIN society_applications a ON a.society_id = s.id
       WHERE s.id = $1
         AND a.status = 'approved'
         AND s.service_status IN ('inactive', 'active')
       FOR SHARE OF s, a`,
      [societyId],
    );

    if (society.rowCount !== 1) {
      throw new ResidentRequestError(
        "NOT_FOUND",
        "This society is not accepting requests.",
        404,
      );
    }

    const result = await operation(client);
    await client.query("COMMIT");
    begun = false;
    return result;
  } catch (error) {
    if (begun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

async function requireAvailableFlat(
  client: PoolClient,
  societyId: string,
  userId: string,
  unitId: string,
): Promise<void> {
  const unit = await client.query(
    `SELECT id FROM society_units
     WHERE id = $1 AND society_id = $2
     FOR SHARE`,
    [unitId, societyId],
  );

  if (unit.rowCount !== 1) {
    throw new ResidentRequestError(
      "NOT_FOUND",
      "Choose a flat belonging to this society.",
      404,
    );
  }

  const membership = await client.query(
    `SELECT id, relationship FROM resident_unit_memberships
     WHERE society_id = $1 AND unit_id = $2
       AND user_id = $3 AND status = 'active'
     LIMIT 1`,
    [societyId, unitId, userId],
  );

  if (membership.rowCount !== 0) {
    throw new ResidentRequestError(
      "ALREADY_ASSOCIATED",
      `You are already registered as ${membership.rows[0].relationship === "owner" ? "an owner" : "a tenant"} of this flat. You cannot create another association for the same flat.`,
      409,
    );
  }
}

async function recordEvent(
  client: PoolClient,
  request: ResidentRequestRecord,
  userId: string,
  action: "created" | "updated" | "submitted" | "resubmitted",
): Promise<void> {
  await client.query(
    `INSERT INTO resident_unit_request_events (
       society_id, request_id, actor_user_id,
       action, request_revision, details
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      request.societyId,
      request.id,
      userId,
      action,
      request.revision,
      JSON.stringify({
        unitId: request.unitId,
        relationship: request.relationship,
        moveInDate: request.moveInDate,
        tenancyEndDate: request.tenancyEndDate,
        applicantProfile: request.applicantProfile,
        applicantNote: request.applicantNote,
      }),
    ],
  );
}


async function accountSnapshot(
  client: PoolClient,
  userId: string,
  profile: ResidentProfile | undefined,
): Promise<ResidentProfile | undefined> {
  // Preserve compatibility when reading or testing historical profiles.
  // HTTP writes with a completed profile require the new revision below.
  if (!profile || profile.correspondenceAccountRevision === undefined) return profile;
  const result = await client.query<{
    fullName: string;
    primary: PrimaryAddress | null;
    revision: number;
  }>(
    `SELECT full_name AS "fullName",
            primary_correspondence_address AS primary,
            correspondence_revision AS revision
     FROM users WHERE id = $1 FOR SHARE`,
    [userId],
  );
  const account = result.rows[0];
  if (!account?.primary ||
      account.revision !== profile.correspondenceAccountRevision) {
    throw new ResidentRequestError(
      "REVISION_CONFLICT",
      "Your account correspondence address changed. Reload it and review your application.",
      409,
    );
  }
  const [firstName, ...rest] = account.fullName.trim().split(/\s+/);
  return {
    ...profile,
    firstName,
    lastName: rest.join(" "),
    correspondenceSameAsFlat: false,
    correspondenceAddress: correspondenceAddressSchema.parse(account.primary.address),
  };
}

// authenticatedUserId must come from the server-validated session.
export async function createResidentRequestDraft(
  authenticatedUserId: string,
  societyId: string,
  input: unknown,
  profileInput?: unknown,
): Promise<ResidentRequestRecord> {
  const data = parseRequest(input);
  let profile = parseProfile(data.relationship, profileInput);

  return withResidentRequestAccess(
    authenticatedUserId,
    societyId,
    async (client) => {
      profile = await accountSnapshot(client, authenticatedUserId, profile);
      await requireAvailableFlat(
        client, societyId, authenticatedUserId, data.unitId,
      );

      const existing = await client.query<ResidentRequestRecord>(
        `SELECT ${returnedColumns}
         FROM resident_unit_requests
         WHERE society_id = $1 AND unit_id = $2 AND user_id = $3
           AND status IN ('draft', 'pending', 'changes_requested')
         FOR UPDATE`,
        [societyId, data.unitId, authenticatedUserId],
      );

      const current = existing.rows[0];
      if (current) {
        // Retrying an unchanged draft creation does not create a duplicate.
        if (
          current.status === "draft" &&
          current.relationship === data.relationship &&
          current.moveInDate === data.moveInDate &&
          current.tenancyEndDate === data.tenancyEndDate &&
          current.applicantNote === data.applicantNote &&
          (profile === undefined ||
            JSON.stringify(current.applicantProfile === null ? null :
              parseProfile(current.relationship, current.applicantProfile)) ===
              JSON.stringify(profile))
        ) {
          return current;
        }

        throw new ResidentRequestError(
          "REQUEST_EXISTS",
          "You already have an open request for this flat. Open that request to continue.",
          409,
        );
      }

      const result = await client.query<ResidentRequestRecord>(
        `INSERT INTO resident_unit_requests (
           society_id, unit_id, user_id, relationship,
           move_in_date, tenancy_end_date, applicant_note,
           owner_review_status, applicant_profile
         ) VALUES (
           $1, $2, $3, $4, $5::date, $6::date, $7,
           CASE WHEN $4 = 'tenant' THEN 'pending' ELSE 'not_required' END,
           $8::jsonb
         )
         RETURNING ${returnedColumns}`,
        [
          societyId, data.unitId, authenticatedUserId,
          data.relationship, data.moveInDate,
          data.tenancyEndDate, data.applicantNote,
          profile === undefined ? null : JSON.stringify(profile),
        ],
      );

      const request = result.rows[0];
      await recordEvent(client, request, authenticatedUserId, "created");
      return request;
    },
  );
}

export async function updateResidentRequestDraft(
  authenticatedUserId: string,
  societyId: string,
  requestId: string,
  expectedRevision: number,
  input: unknown,
  profileInput?: unknown,
): Promise<ResidentRequestRecord> {
  requireUuid(requestId);
  const data = parseRequest(input);
  let profile = parseProfile(data.relationship, profileInput);

  if (!residentRequestSubmissionSchema.safeParse({ expectedRevision }).success) {
    throw new ResidentRequestError(
      "INVALID_INPUT", "Send a valid request revision.", 400,
    );
  }

  return withResidentRequestAccess(
    authenticatedUserId,
    societyId,
    async (client) => {
      const result = await client.query<ResidentRequestRecord>(
        `SELECT ${returnedColumns}
         FROM resident_unit_requests
         WHERE id = $1 AND society_id = $2 AND user_id = $3
         FOR UPDATE`,
        [requestId, societyId, authenticatedUserId],
      );

      const current = result.rows[0];
      if (!current) {
        throw new ResidentRequestError(
          "NOT_FOUND", "Request not found.", 404,
        );
      }
      if (current.status !== "draft" && current.status !== "changes_requested") {
        throw new ResidentRequestError(
          "NOT_EDITABLE", "Only drafts and returned applications can be edited.", 409,
        );
      }
      if (current.revision !== expectedRevision) {
        throw new ResidentRequestError(
          "REVISION_CONFLICT",
          "This request has changed. Reload it before saving.",
          409,
        );
      }
      if (data.relationship !== current.relationship) {
        const documents = await client.query(
          `SELECT 1 FROM resident_documents d
           WHERE (d.request_id = $1 OR d.tenancy_id = (
             SELECT tenancy_id FROM resident_unit_requests WHERE id = $1
           )) AND d.status <> 'deleted' LIMIT 1`, [requestId],
        );
        const tenancy = await client.query(
          `SELECT 1 FROM resident_unit_requests WHERE id=$1 AND tenancy_id IS NOT NULL`,
          [requestId],
        );
        if (documents.rowCount || tenancy.rowCount) {
          throw new ResidentRequestError(
            "INVALID_INPUT",
            "This draft already has documents or tenancy records. Keep its relationship and use a separate application for a different role.", 400,
          );
        }
      }
      if (current.status === "changes_requested" &&
          data.relationship !== current.relationship) {
        throw new ResidentRequestError(
          "INVALID_INPUT",
          "The relationship cannot change during corrections. Start a separate application if needed.",
          400,
        );
      }
      if (data.unitId !== current.unitId) {
        throw new ResidentRequestError(
          "INVALID_INPUT",
          "A request's flat cannot be changed. Start a separate request for another flat.",
          400,
        );
      }

      await requireAvailableFlat(
        client, societyId, authenticatedUserId, current.unitId,
      );

      profile = await accountSnapshot(client, authenticatedUserId, profile);

      // Older clients preserve an existing profile. Validate it against
      // any relationship change instead of silently retaining invalid data.
      const linkedTenancy = await client.query<{ tenancy_id: string | null }>(
        `SELECT tenancy_id FROM resident_unit_requests WHERE id=$1`, [requestId],
      );
      if (linkedTenancy.rows[0]?.tenancy_id) {
        if (!data.moveInDate) throw new ResidentRequestError(
          "INVALID_INPUT", "Keep the move-in date while this application has a tenancy agreement.", 400,
        );
        const lease = await client.query(
          `UPDATE resident_tenancies SET starts_on=$3, ends_on=$4,
             revision=revision+1, updated_at=clock_timestamp()
           WHERE id=$1 AND created_by=$2 AND status='draft' RETURNING id`,
          [linkedTenancy.rows[0].tenancy_id, authenticatedUserId, data.moveInDate,
           data.tenancyEndDate],
        );
        if (!lease.rowCount) throw new ResidentRequestError(
          "NOT_EDITABLE", "This tenancy cannot be edited here.", 409,
        );
      }
      const savedProfile = profile === undefined
        ? (current.applicantProfile === null ? null :
            parseProfile(data.relationship, current.applicantProfile))
        : profile;

      const updated = await client.query<ResidentRequestRecord>(
        `UPDATE resident_unit_requests
         SET relationship = $4,
             owner_review_status = CASE
               WHEN $4 = 'tenant' THEN 'pending'
               ELSE 'not_required'
             END,
             owner_reviewed_at = NULL,
             owner_reviewed_by = NULL,
             owner_review_note = NULL,
             owner_reviewed_agreement_id = NULL,
             move_in_date = $5::date,
             tenancy_end_date = $6::date,
             applicant_note = $7,
             applicant_profile = $8::jsonb,
             revision = revision + 1,
             updated_at = clock_timestamp()
         WHERE id = $1 AND society_id = $2 AND user_id = $3
         RETURNING ${returnedColumns}`,
        [
          requestId, societyId, authenticatedUserId,
          data.relationship, data.moveInDate,
          data.tenancyEndDate, data.applicantNote,
          savedProfile == null ? null : JSON.stringify(savedProfile),
        ],
      );

      const request = updated.rows[0];
      await recordEvent(client, request, authenticatedUserId, "updated");
      return request;
    },
  );
}


export async function submitOwnerApplication(
  userId: string,
  societyId: string,
  requestId: string,
  expectedRevision: number,
): Promise<ResidentRequestRecord> {
  requireUuid(requestId);
  if (!residentRequestSubmissionSchema.safeParse({ expectedRevision }).success) {
    throw new ResidentRequestError(
      "INVALID_INPUT", "Reload the application before submitting.", 400,
    );
  }

  return withResidentRequestAccess(userId, societyId, async (client) => {
    const result = await client.query<ResidentRequestRecord>(
      `SELECT ${returnedColumns}
       FROM resident_unit_requests
       WHERE id = $1 AND society_id = $2 AND user_id = $3
       FOR UPDATE`,
      [requestId, societyId, userId],
    );
    const current = result.rows[0];
    if (!current) {
      throw new ResidentRequestError("NOT_FOUND", "Application not found.", 404);
    }
    if (current.relationship !== "owner") {
      throw new ResidentRequestError(
        "INVALID_INPUT",
        "Tenant applications need the separate tenancy and owner-review workflow.",
        400,
      );
    }

    // A repeated click or retry must not create a second submission.
    if (current.status === "pending" &&
        current.revision === expectedRevision + 1) return current;

    if (current.status !== "draft" && current.status !== "changes_requested") {
      throw new ResidentRequestError(
        "NOT_EDITABLE", "This application has already left the draft stage.", 409,
      );
    }
    if (current.revision !== expectedRevision) {
      throw new ResidentRequestError(
        "REVISION_CONFLICT", "Your application changed. Refresh before submitting.", 409,
      );
    }
    if (!current.applicantProfile) {
      throw new ResidentRequestError(
        "INVALID_INPUT", "Complete and save your personal details first.", 400,
      );
    }

    parseRequest({
      unitId: current.unitId,
      relationship: current.relationship,
      moveInDate: current.moveInDate,
      tenancyEndDate: current.tenancyEndDate,
      applicantNote: current.applicantNote,
    });
    parseProfile("owner", current.applicantProfile);
    await requireAvailableFlat(client, societyId, userId, current.unitId);

    const updated = await client.query<ResidentRequestRecord>(
      `UPDATE resident_unit_requests
       SET status = 'pending', submitted_at = clock_timestamp(),
           reviewed_at = NULL, reviewed_by = NULL, review_note = NULL,
           updated_at = clock_timestamp(), revision = revision + 1
       WHERE id = $1
       RETURNING ${returnedColumns}`,
      [requestId],
    );
    await recordEvent(
      client, updated.rows[0], userId,
      current.status === "changes_requested" ? "resubmitted" : "submitted",
    );
    return updated.rows[0];
  });
}
