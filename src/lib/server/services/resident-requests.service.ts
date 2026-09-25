import "server-only";
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
  status: "draft" | "pending" | "approved" | "rejected" | "withdrawn";
  moveInDate: string | null;
  tenancyEndDate: string | null;
  applicantNote: string | null;
  revision: number;
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

async function withResidentRequestAccess<T>(
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
    `SELECT id FROM resident_unit_memberships
     WHERE society_id = $1 AND unit_id = $2
       AND user_id = $3 AND status = 'active'
     LIMIT 1`,
    [societyId, unitId, userId],
  );

  if (membership.rowCount !== 0) {
    throw new ResidentRequestError(
      "ALREADY_ASSOCIATED",
      "An association already exists for this flat. Contact the chairman to update it.",
      409,
    );
  }
}

async function recordEvent(
  client: PoolClient,
  request: ResidentRequestRecord,
  userId: string,
  action: "created" | "updated",
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
      }),
    ],
  );
}

// authenticatedUserId must come from the server-validated session.
export async function createResidentRequestDraft(
  authenticatedUserId: string,
  societyId: string,
  input: unknown,
): Promise<ResidentRequestRecord> {
  const data = parseRequest(input);

  return withResidentRequestAccess(
    authenticatedUserId,
    societyId,
    async (client) => {
      await requireAvailableFlat(
        client, societyId, authenticatedUserId, data.unitId,
      );

      const existing = await client.query<ResidentRequestRecord>(
        `SELECT ${returnedColumns}
         FROM resident_unit_requests
         WHERE society_id = $1 AND unit_id = $2 AND user_id = $3
           AND status IN ('draft', 'pending')
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
          current.applicantNote === data.applicantNote
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
           owner_review_status
         ) VALUES (
           $1, $2, $3, $4, $5::date, $6::date, $7,
           CASE WHEN $4 = 'tenant' THEN 'pending' ELSE 'not_required' END
         )
         RETURNING ${returnedColumns}`,
        [
          societyId, data.unitId, authenticatedUserId,
          data.relationship, data.moveInDate,
          data.tenancyEndDate, data.applicantNote,
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
): Promise<ResidentRequestRecord> {
  requireUuid(requestId);
  const data = parseRequest(input);

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
      if (current.status !== "draft") {
        throw new ResidentRequestError(
          "NOT_EDITABLE", "Only a draft request can be edited.", 409,
        );
      }
      if (current.revision !== expectedRevision) {
        throw new ResidentRequestError(
          "REVISION_CONFLICT",
          "This request has changed. Reload it before saving.",
          409,
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
             move_in_date = $5::date,
             tenancy_end_date = $6::date,
             applicant_note = $7,
             revision = revision + 1,
             updated_at = clock_timestamp()
         WHERE id = $1 AND society_id = $2 AND user_id = $3
         RETURNING ${returnedColumns}`,
        [
          requestId, societyId, authenticatedUserId,
          data.relationship, data.moveInDate,
          data.tenancyEndDate, data.applicantNote,
        ],
      );

      const request = updated.rows[0];
      await recordEvent(client, request, authenticatedUserId, "updated");
      return request;
    },
  );
}
