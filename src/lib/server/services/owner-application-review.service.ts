import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import { getDatabase } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { requireChairmanSetupAccess } from "./society-access.service";
import { lockSocietyUnitManagement } from "@/lib/server/repositories/unit-capacity.repository";
import { residentRequestReviewSchema } from "@/lib/contracts/resident-associations";
import type { InboxApplication } from "@/lib/contracts/application-inbox";

const filtersSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  status: z.enum([
    "all", "draft", "pending", "changes_requested", "approved", "rejected", "withdrawn",
  ]).default("all"),
  application: z.uuid().optional(),
});

function uuid(value: string) {
  if (!z.uuid().safeParse(value).success) {
    throw new HttpError(400, "Choose a valid application or society.");
  }
}

async function withChairman<T>(
  userId: string,
  societyId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  uuid(userId);
  uuid(societyId);
  const client = await getDatabase().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await lockSocietyUnitManagement(client, societyId);
    await requireChairmanSetupAccess(client, userId, societyId);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}

export async function listApplicationInbox(
  userId: string,
  societyId: string | null,
  input: unknown,
) {
  uuid(userId);
  const parsed = filtersSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Invalid application filters.");
  const filters = parsed.data;

  const sql = `
    SELECT r.id, r.society_id AS "societyId", s.name AS "societyName",
           u.wing, u.floor_label AS floor, u.flat_number AS "flatNumber",
           r.relationship, r.status, r.revision,
           r.owner_review_status AS "ownerReviewStatus",
           a.full_name AS "fullName", a.email, a.phone,
           r.applicant_profile AS "applicantProfile",
           r.applicant_note AS "applicantNote",
           r.move_in_date::text AS "moveInDate",
           to_char(r.submitted_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "submittedAt",
           to_char(r.reviewed_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "reviewedAt",
           r.review_note AS "reviewNote",
           r.user_id = $1::uuid AS "isOwn",
           (
             SELECT CASE
               WHEN membership.status = 'revoked' THEN 'ended'
               WHEN membership.relationship = 'tenant'
                 AND membership.tenancy_end_date <
                   (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'ended'
               WHEN membership.relationship = 'tenant'
                 AND membership.move_in_date >
                   (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'scheduled'
               ELSE 'active'
             END
             FROM resident_unit_memberships membership
             WHERE membership.source_request_id = r.id
               AND membership.user_id = r.user_id
               AND membership.society_id = r.society_id
               AND membership.unit_id = r.unit_id
               AND membership.relationship = r.relationship
           ) AS "associationStatus",
           CASE WHEN $2::uuid IS NOT NULL THEN COALESCE((
             SELECT jsonb_agg(
               jsonb_build_object(
                 'membershipId', ownership.id,
                 'fullName', owner_account.full_name
               ) ORDER BY owner_account.full_name, ownership.id
             )
             FROM resident_unit_memberships ownership
             JOIN users owner_account ON owner_account.id = ownership.user_id
             WHERE ownership.society_id = r.society_id
               AND ownership.unit_id = r.unit_id
               AND ownership.relationship = 'owner'
               AND ownership.status = 'active'
           ), '[]'::jsonb) ELSE '[]'::jsonb END AS "currentOwners",
           (SELECT count(*)::integer FROM resident_unit_request_events e
            WHERE e.request_id = r.id AND e.society_id = r.society_id
              AND e.action = 'resubmitted') AS "resubmissionCount",
           COALESCE((
             SELECT jsonb_agg(h.entry ORDER BY h.created_at DESC, h.id DESC)
             FROM (
               SELECT e.id, e.created_at, jsonb_build_object(
                 'action', e.action, 'revision', e.request_revision,
                 'at', to_char(e.created_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'note', e.details ->> 'reviewNote'
               ) AS entry
               FROM resident_unit_request_events e
               WHERE e.request_id = r.id AND e.society_id = r.society_id
               ORDER BY e.created_at DESC, e.id DESC LIMIT 100
             ) h
           ), '[]'::jsonb) AS history
    FROM resident_unit_requests r
    JOIN societies s ON s.id = r.society_id
    JOIN society_units u ON u.id = r.unit_id AND u.society_id = r.society_id
    JOIN users a ON a.id = r.user_id
    WHERE ${
      societyId
        ? `r.society_id = $2::uuid AND r.relationship = 'owner'
           AND r.status IN ('pending', 'changes_requested', 'approved', 'rejected')`
        : "r.user_id = $1::uuid AND $2::uuid IS NULL"
    }
      AND r.deleted_at IS NULL
      AND ($3 = 'all' OR r.status = $3)
      AND ($4::uuid IS NULL OR r.id = $4::uuid)
    ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
             r.created_at DESC, r.id DESC
    LIMIT 21 OFFSET $5`;

  const values = [
    userId, societyId, filters.status, filters.application ?? null,
    (filters.page - 1) * 20,
  ];
  async function load(client: PoolClient) {
    const result = await client.query<InboxApplication>(sql, values);
    const totals = await client.query<{ status: string; count: number }>(
      `SELECT r.status, count(*)::integer AS count
       FROM resident_unit_requests r
       WHERE ${societyId
         ? `r.society_id = $2::uuid AND $1::uuid IS NOT NULL
            AND r.relationship = 'owner'
            AND r.status IN ('pending', 'changes_requested', 'approved', 'rejected')`
         : "r.user_id = $1::uuid AND $2::uuid IS NULL"}
       AND r.deleted_at IS NULL
       GROUP BY r.status`,
      [userId, societyId],
    );
    const counts: Record<string, number> = {
      all: 0, draft: 0, pending: 0, changes_requested: 0,
      approved: 0, rejected: 0, withdrawn: 0,
    };
    for (const row of totals.rows) {
      counts[row.status] = row.count;
      counts.all += row.count;
    }
    return {
      items: result.rows.slice(0, 20),
      hasMore: result.rows.length > 20,
      page: filters.page,
      counts,
    };
  }

  if (societyId) return withChairman(userId, societyId, load);
  const client = await getDatabase().connect();
  try { return await load(client); }
  finally { client.release(); }
}

export async function reviewOwnerApplication(
  userId: string,
  societyId: string,
  requestId: string,
  input: unknown,
) {
  uuid(requestId);
  const parsed = residentRequestReviewSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check your decision.");
  }
  const decision = parsed.data;

  return withChairman(userId, societyId, async (client) => {
    const result = await client.query<{
      id: string; user_id: string; unit_id: string;
      status: string; revision: number;
      reviewed_by: string | null; review_note: string | null;
    }>(
      `SELECT id, user_id, unit_id, status, revision, reviewed_by, review_note
       FROM resident_unit_requests
       WHERE id = $1 AND society_id = $2 AND relationship = 'owner'
         AND status IN ('pending', 'changes_requested', 'approved', 'rejected')
       FOR UPDATE`,
      [requestId, societyId],
    );
    const current = result.rows[0];
    if (!current) throw new HttpError(404, "Application not found.");
    if (current.user_id === userId) {
      throw new HttpError(403, "You cannot review your own owner application.");
    }

    if (current.status === decision.decision &&
        current.revision === decision.expectedRevision + 1 &&
        current.reviewed_by === userId &&
        current.review_note === decision.reviewNote) {
      return { id: current.id, status: current.status, revision: current.revision };
    }
    if (current.status !== "pending" ||
        current.revision !== decision.expectedRevision) {
      throw new HttpError(409, "This application changed. Refresh before reviewing.");
    }

    if (decision.decision === "approved") {
      // withChairman already holds the society transaction lock.
      // All ordinary approvals use that same lock, so competing approvals
      // cannot both observe an owner-free flat.
      const ownership = await client.query(
        `SELECT id
         FROM resident_unit_memberships
         WHERE society_id = $1 AND unit_id = $2
           AND relationship = 'owner' AND status = 'active'
         LIMIT 1`,
        [societyId, current.unit_id],
      );
      if (ownership.rowCount) {
        throw new HttpError(
          409,
          "This flat already has an active registered owner. Ordinary approval is blocked. Adding a co-owner or transferring ownership requires a separate review.",
        );
      }

      const eligible = await client.query(
        `SELECT u.id FROM users u
         WHERE u.id = $1 AND u.status = 'active'
           AND u.email_verified_at IS NOT NULL
           AND (u.phone_verified_at IS NOT NULL OR u.verification_policy = 'email_only')
           AND NOT EXISTS (SELECT 1 FROM platform_admins p WHERE p.user_id = u.id)
         FOR SHARE OF u`,
        [current.user_id],
      );
      if (eligible.rowCount !== 1) {
        throw new HttpError(409, "The applicant's account is not eligible for approval.");
      }

      const existing = await client.query(
        `SELECT id FROM resident_unit_memberships
         WHERE user_id = $1 AND unit_id = $2 AND status = 'active'`,
        [current.user_id, current.unit_id],
      );
      if (existing.rowCount) {
        throw new HttpError(409, "This applicant already has an active flat membership.");
      }
    }

    const updated = await client.query(
      `UPDATE resident_unit_requests
       SET status = $2, reviewed_by = $3, reviewed_at = clock_timestamp(),
           review_note = $4, revision = revision + 1, updated_at = clock_timestamp()
       WHERE id = $1 RETURNING id, status, revision`,
      [requestId, decision.decision, userId, decision.reviewNote],
    );

    if (decision.decision === "approved") {
      await client.query(
        `INSERT INTO resident_unit_memberships (
           society_id, unit_id, user_id, relationship, source_request_id,
           status, approved_by, move_in_date
         )
         SELECT society_id, unit_id, user_id, relationship, id,
                'active', $2, move_in_date
         FROM resident_unit_requests WHERE id = $1`,
        [requestId, userId],
      );
    }

    await client.query(
      `INSERT INTO resident_unit_request_events (
         society_id, request_id, actor_user_id, action, request_revision, details
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        societyId, requestId, userId, decision.decision,
        updated.rows[0].revision,
        JSON.stringify({ reviewNote: decision.reviewNote }),
      ],
    );
    return updated.rows[0];
  });
}
