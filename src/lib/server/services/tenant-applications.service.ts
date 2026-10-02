import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import { getDatabase } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { residentApplicationProfileSchema } from "@/lib/contracts/resident-profile";
import { residentRequestSubmissionSchema, residentRequestReviewSchema } from "@/lib/contracts/resident-associations";
import type { TenantReviewItem } from "@/lib/contracts/tenant-review";
import { withResidentRequestAccess, submitOwnerApplication } from "./resident-requests.service";
import { withChairmanUnitAccess } from "./units.service";

type TenantRequest = {
  id: string; society_id: string; unit_id: string; user_id: string;
  relationship: string; status: string; revision: number;
  tenancy_id: string | null; move_in_date: string | null; tenancy_end_date: string | null;
  applicant_profile: unknown; owner_review_status: string;
  owner_reviewed_by: string | null; owner_reviewed_agreement_id: string | null;
};

async function lockRequest(client: PoolClient, society: string, id: string) {
  const result = await client.query<TenantRequest>(
    `SELECT *,move_in_date::text,tenancy_end_date::text FROM resident_unit_requests
     WHERE id=$1 AND society_id=$2 AND relationship='tenant' FOR UPDATE`, [id, society],
  );
  if (!result.rows[0]) throw new HttpError(404, "Tenant application not found.");
  return result.rows[0];
}

async function eligible(client: PoolClient, user: string) {
  const result = await client.query(
    `SELECT id FROM users u WHERE id=$1 AND status='active' AND email_verified_at IS NOT NULL
     AND (phone_verified_at IS NOT NULL OR verification_policy='email_only')
     AND NOT EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=u.id) FOR SHARE`, [user],
  );
  if (!result.rowCount) throw new HttpError(403, "This account is not eligible for tenant review.");
}

async function registeredOwner(client: PoolClient, request: TenantRequest, actor?: string) {
  const result = await client.query<{ id: string; user_id: string; source_request_id: string }>(
    `SELECT m.id,m.user_id,m.source_request_id FROM resident_unit_memberships m
     JOIN resident_unit_requests r ON r.id=m.source_request_id AND r.society_id=m.society_id
       AND r.unit_id=m.unit_id AND r.user_id=m.user_id AND r.relationship='owner'
     JOIN users u ON u.id=m.user_id
     WHERE m.society_id=$1 AND m.unit_id=$2 AND m.relationship='owner' AND m.status='active'
       AND r.status='approved' AND m.user_id<>$3
       AND ($4::uuid IS NULL OR m.user_id=$4)
       AND u.status='active' AND u.email_verified_at IS NOT NULL
       AND (u.phone_verified_at IS NOT NULL OR u.verification_policy='email_only')
       AND NOT EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=u.id)
     ORDER BY m.id FOR SHARE OF m,r,u`,
    [request.society_id, request.unit_id, request.user_id, actor ?? null],
  );
  if (!result.rowCount) throw new HttpError(409, "This flat needs an active, verified registered owner before tenant verification.");
  return result.rows;
}

async function documentsAndDates(client: PoolClient, request: TenantRequest) {
  const profile = residentApplicationProfileSchema.safeParse({ relationship: "tenant", profile: request.applicant_profile });
  if (!profile.success || !profile.data.profile.residesInFlat) {
    throw new HttpError(400, "Complete and save your tenant details before submitting.");
  }
  if (!request.move_in_date) throw new HttpError(400, "Save your move-in date before submitting.");
  if (!request.tenancy_id) throw new HttpError(400, "Upload a rental agreement with Rental agreement selected as its document purpose.");
  const tenancy = await client.query(
    `SELECT id FROM resident_tenancies WHERE id=$1 AND society_id=$2 AND unit_id=$3
     AND created_by=$4 AND status='draft' AND starts_on=$5::date
     AND ends_on IS NOT DISTINCT FROM $6::date
     AND (ends_on IS NULL OR ends_on >= (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date)
     FOR SHARE`,
    [request.tenancy_id, request.society_id, request.unit_id, request.user_id, request.move_in_date, request.tenancy_end_date],
  );
  if (!tenancy.rowCount) throw new HttpError(409, "The tenancy dates or status changed, or the agreement has expired. Edit and save the application.");
  const identity = await client.query(
    `SELECT id FROM resident_documents WHERE request_id=$1 AND society_id=$2
     AND subject_user_id=$3 AND uploaded_by=$3 AND kind='identity' AND status='ready' FOR SHARE`,
    [request.id, request.society_id, request.user_id],
  );
  if (!identity.rowCount) throw new HttpError(400, "Upload a checked identity document before submitting.");
  const agreement = await client.query<{ id: string; created_at: Date }>(
    `SELECT id,created_at FROM resident_documents WHERE tenancy_id=$1 AND society_id=$2
     AND uploaded_by=$3 AND kind='rental_agreement' AND status='ready'
     ORDER BY agreement_version DESC,id DESC LIMIT 1 FOR SHARE`,
    [request.tenancy_id, request.society_id, request.user_id],
  );
  if (!agreement.rows[0]) throw new HttpError(400, "Upload a checked rental agreement using the Rental agreement document purpose.");
  return agreement.rows[0];
}

async function event(client: PoolClient, request: TenantRequest, user: string, action: string, revision: number, note: string | null) {
  await client.query(
    `INSERT INTO resident_unit_request_events(society_id,request_id,actor_user_id,action,request_revision,details)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [request.society_id, request.id, user, action, revision, JSON.stringify({ reviewNote: note })],
  );
}

export async function submitResidentApplication(user: string, society: string, id: string, revision: number) {
  if (![user, society, id].every((value) => z.uuid().safeParse(value).success) ||
      !residentRequestSubmissionSchema.safeParse({ expectedRevision: revision }).success) {
    throw new HttpError(400, "Reload and check the application.");
  }
  const lookup = await getDatabase().query(
    "SELECT relationship FROM resident_unit_requests WHERE id=$1 AND society_id=$2 AND user_id=$3", [id, society, user],
  );
  if (!lookup.rows[0]) throw new HttpError(404, "Application not found.");
  if (lookup.rows[0].relationship === "owner") return submitOwnerApplication(user, society, id, revision);
  return withResidentRequestAccess(user, society, async (client) => {
    const request = await lockRequest(client, society, id);
    if (request.user_id !== user) throw new HttpError(404, "Application not found.");
    if (request.status === "pending" && request.revision === revision + 1) return { id, status: request.status, revision: request.revision };
    if (!["draft", "changes_requested"].includes(request.status) || request.revision !== revision) throw new HttpError(409, "Your application changed. Refresh before submitting.");
    await registeredOwner(client, request);
    await documentsAndDates(client, request);
    const member = await client.query("SELECT id FROM resident_unit_memberships WHERE unit_id=$1 AND user_id=$2 AND status='active'", [request.unit_id, user]);
    if (member.rowCount) throw new HttpError(409, "You already have an active association with this flat.");
    const saved = await client.query(
      `UPDATE resident_unit_requests SET status='pending',submitted_at=clock_timestamp(),
       reviewed_at=NULL,reviewed_by=NULL,review_note=NULL,
       owner_review_status='pending',owner_reviewed_at=NULL,owner_reviewed_by=NULL,
       owner_review_note=NULL,owner_reviewed_agreement_id=NULL,
       revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING id,status,revision`, [id],
    );
    await event(client, request, user, request.status === "draft" ? "submitted" : "resubmitted", saved.rows[0].revision, null);
    return saved.rows[0];
  });
}

export async function reviewTenantApplication(user: string, society: string, id: string, input: unknown, stage: "owner" | "chairman") {
  if (![user, society, id].every((value) => z.uuid().safeParse(value).success)) throw new HttpError(400, "Invalid application.");
  const parsed = residentRequestReviewSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check your decision.");
  const decision = parsed.data;
  const operation = async (client: PoolClient) => {
    const request = await lockRequest(client, society, id);
    if (request.user_id === user) throw new HttpError(403, "You cannot review your own tenant application.");
    if (request.status !== "pending" || request.revision !== decision.expectedRevision) throw new HttpError(409, "This application changed. Refresh before reviewing.");
    if (stage === "owner") {
      await registeredOwner(client, request, user);
      if (request.owner_review_status !== "pending") throw new HttpError(409, "Owner verification has already been recorded.");
    } else {
      if (request.owner_review_status !== "approved" || !request.owner_reviewed_by) throw new HttpError(409, "Owner verification must be completed first.");
      if (request.owner_reviewed_by === user) throw new HttpError(403, "A different chairman must perform the second verification.");
      await registeredOwner(client, request, request.owner_reviewed_by);
    }
    let agreementId: string | null = null;
    if (decision.decision === "approved") {
      await eligible(client, request.user_id);
      const agreement = await documentsAndDates(client, request);
      agreementId = agreement.id;
      if (stage === "chairman" && agreement.id !== request.owner_reviewed_agreement_id) throw new HttpError(409, "The agreement changed. Request corrections so the owner can verify it again.");
      if (stage === "owner") {
        const blocked = await client.query(
          `SELECT 1 FROM owner_transfers tr JOIN resident_unit_memberships m ON m.source_request_id=tr.request_id
           WHERE m.user_id=$1 AND m.unit_id=$2 AND m.status='active'
             AND tr.status='completed' AND tr.completed_at>$3 LIMIT 1`, [user, request.unit_id, agreement.created_at],
        );
        if (blocked.rowCount) throw new HttpError(409, "This agreement predates your ownership transfer. Request a current agreement.");
      }
      if (stage === "chairman") {
        const overlap = await client.query(
          `SELECT 1 FROM resident_unit_memberships m WHERE m.unit_id=$1 AND m.society_id=$2 AND m.status='active'
           AND (m.user_id=$3 OR (m.relationship='tenant'
             AND COALESCE(m.move_in_date,'-infinity'::date)<=COALESCE($5::date,'infinity'::date)
             AND COALESCE(m.tenancy_end_date,'infinity'::date)>=$4::date)) LIMIT 1`,
          [request.unit_id, society, request.user_id, request.move_in_date, request.tenancy_end_date],
        );
        if (overlap.rowCount) throw new HttpError(409, "An active association or overlapping tenancy already exists. Shared tenancy needs its own participant workflow.");
      }
    }
    let saved;
    if (stage === "owner" && decision.decision === "approved") {
      saved = await client.query(
        `UPDATE resident_unit_requests SET owner_review_status='approved',owner_reviewed_at=clock_timestamp(),
         owner_reviewed_by=$2,owner_review_note=$3,owner_reviewed_agreement_id=$4,
         revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING id,status,revision`,
        [id, user, decision.reviewNote, agreementId],
      );
    } else {
      saved = await client.query(
        `UPDATE resident_unit_requests SET status=$2,reviewed_at=clock_timestamp(),reviewed_by=$3,review_note=$4,
         owner_review_status=CASE WHEN $5='owner' THEN 'rejected' ELSE owner_review_status END,
         owner_reviewed_at=CASE WHEN $5='owner' THEN clock_timestamp() ELSE owner_reviewed_at END,
         owner_reviewed_by=CASE WHEN $5='owner' THEN $3 ELSE owner_reviewed_by END,
         owner_review_note=CASE WHEN $5='owner' THEN $4 ELSE owner_review_note END,
         owner_reviewed_agreement_id=CASE WHEN $5='owner' THEN NULL ELSE owner_reviewed_agreement_id END,
         revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING id,status,revision`,
        [id, decision.decision, user, decision.reviewNote, stage],
      );
    }
    if (stage === "chairman" && decision.decision === "approved") {
      await client.query(
        `INSERT INTO resident_unit_memberships(society_id,unit_id,user_id,relationship,source_request_id,
          approved_by,move_in_date,tenancy_end_date)
         VALUES($1,$2,$3,'tenant',$4,$5,$6::date,$7::date)`,
        [society, request.unit_id, request.user_id, id, user, request.move_in_date, request.tenancy_end_date],
      );
      await client.query("UPDATE resident_tenancies SET status='active',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1", [request.tenancy_id]);
      await client.query(
        `INSERT INTO resident_tenancy_events(society_id,tenancy_id,actor_user_id,action) VALUES($1,$2,$3,'activated')`,
        [society, request.tenancy_id, user],
      );
    }
    const action = stage === "owner" ? decision.decision === "approved" ? "owner_verified" : `owner_${decision.decision}` : decision.decision;
    await event(client, request, user, action, saved.rows[0].revision, decision.reviewNote);
    return saved.rows[0];
  };
  return stage === "owner" ? withResidentRequestAccess(user, society, operation) : withChairmanUnitAccess(user, society, operation);
}

export async function listTenantReviews(user: string, society: string | null, page: number) {
  if (!z.uuid().safeParse(user).success || (society !== null && !z.uuid().safeParse(society).success)) throw new HttpError(400, "Invalid review scope.");
  const load = async (client: PoolClient) => {
    await eligible(client, user);
    const result = await client.query<TenantReviewItem>(
      `SELECT r.id,r.society_id AS "societyId",s.name AS "societyName",u.wing,u.flat_number AS "flatNumber",
       a.full_name AS "fullName",r.revision,r.move_in_date::text AS "moveInDate",
       r.tenancy_end_date::text AS "tenancyEndDate",r.owner_review_status AS "ownerReviewStatus",
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.original_filename,'kind',d.kind) ORDER BY d.created_at,d.id)
         FROM resident_documents d WHERE d.society_id=r.society_id AND d.status='ready'
         AND ((d.request_id=r.id AND d.subject_user_id=r.user_id AND d.kind='identity')
           OR ($2::uuid IS NULL AND d.tenancy_id=r.tenancy_id AND d.uploaded_by=r.user_id AND d.kind='rental_agreement'))),'[]'::jsonb) AS documents
       FROM resident_unit_requests r JOIN societies s ON s.id=r.society_id
       JOIN society_units u ON u.id=r.unit_id AND u.society_id=r.society_id JOIN users a ON a.id=r.user_id
       WHERE r.relationship='tenant' AND r.status='pending' AND r.user_id<>$1
       AND s.service_status IN ('inactive','active')
       AND EXISTS(SELECT 1 FROM society_applications sa WHERE sa.society_id=s.id AND sa.status='approved')
       AND (($2::uuid IS NOT NULL AND r.society_id=$2 AND r.owner_review_status='approved')
         OR ($2::uuid IS NULL AND r.owner_review_status='pending' AND EXISTS(
           SELECT 1 FROM resident_unit_memberships m JOIN resident_unit_requests own ON own.id=m.source_request_id
             AND own.society_id=m.society_id AND own.unit_id=m.unit_id AND own.user_id=m.user_id
           WHERE m.user_id=$1 AND m.unit_id=r.unit_id AND m.society_id=r.society_id
             AND m.relationship='owner' AND m.status='active' AND own.relationship='owner' AND own.status='approved')))
       ORDER BY r.submitted_at,r.id LIMIT 21 OFFSET $3`, [user, society, (page - 1) * 20],
    );
    return { items: result.rows.slice(0, 20), hasMore: result.rows.length > 20 };
  };
  if (society) return withChairmanUnitAccess(user, society, load);
  const client = await getDatabase().connect();
  try { return await load(client); } finally { client.release(); }
}
