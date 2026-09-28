import "server-only";
import { z } from "zod";
import { getDatabase } from "@/lib/server/db";
import {
  documentAccessBasis,
  type DocumentAccessBasis,
  type DocumentAccessContext,
} from "./resident-document-policy";

export class ResidentDocumentAccessError extends Error {
  readonly status = 403;
  readonly code = "DOCUMENT_NOT_AVAILABLE";

  constructor() {
    super("This document is not available to your account.");
    this.name = "ResidentDocumentAccessError";
  }
}

type AccessRow = {
  societyId: string;
  storageBucket: string;
  storageKey: string;
  originalFilename: string;
  contentType: string | null;
  context: DocumentAccessContext;
};

// Internal result for the storage service.
// Never send bucket names or storage keys in a public API response.
export type ResidentDocumentGrant = {
  documentId: string;
  storageBucket: string;
  storageKey: string;
  originalFilename: string;
  contentType: string;
  accessBasis: DocumentAccessBasis;
};

// authenticatedUserId must come from a validated server session.
export async function authoriseResidentDocumentRead(
  authenticatedUserId: string,
  documentId: string,
): Promise<ResidentDocumentGrant> {
  if (
    !z.uuid().safeParse(authenticatedUserId).success ||
    !z.uuid().safeParse(documentId).success
  ) {
    throw new ResidentDocumentAccessError();
  }

  const client = await getDatabase().connect();
  let begun = false;
  let discard = false;

  try {
    await client.query("BEGIN");
    begun = true;

    const result = await client.query<AccessRow>(
      `SELECT
         d.society_id AS "societyId",
         d.storage_bucket AS "storageBucket",
         d.storage_key AS "storageKey",
         d.original_filename AS "originalFilename",
         d.verified_content_type AS "contentType",

         jsonb_build_object(
           'accountEligible', EXISTS (
             SELECT 1 FROM users u
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
                 SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id
               )
           ),

           'documentReady', d.status = 'ready',

           'societyAvailable',
             s.service_status IN ('inactive', 'active')
             AND EXISTS (
               SELECT 1 FROM society_applications a
               WHERE a.society_id = s.id AND a.status = 'approved'
             ),

           'kind', d.kind,

           'isIdentitySubject', COALESCE(d.subject_user_id = $1, false),

           'isVerifiedFlatOwner', EXISTS (
             SELECT 1
             FROM resident_unit_memberships m
             JOIN resident_unit_requests source
               ON source.id = m.source_request_id
              AND source.society_id = m.society_id
              AND source.unit_id = m.unit_id
              AND source.user_id = m.user_id
             WHERE m.user_id = $1
               AND m.society_id = d.society_id
               AND m.unit_id = COALESCE(r.unit_id, tenancy.unit_id)
               AND m.relationship = 'owner'
               AND m.status = 'active'
               AND source.status = 'approved'
               AND (
                 d.kind <> 'rental_agreement' OR NOT EXISTS (
                   SELECT 1 FROM owner_transfers ownership_transfer
                   WHERE ownership_transfer.request_id = m.source_request_id
                     AND ownership_transfer.status = 'completed'
                     AND d.created_at < ownership_transfer.completed_at
                 )
               )
           ),

           'isAuthorisedChairman', EXISTS (
             SELECT 1 FROM society_memberships cm
             WHERE cm.user_id = $1
               AND cm.society_id = d.society_id
               AND cm.role = 'chairman'
               AND cm.status = 'active'
           ),

           'requestStatus', COALESCE(r.status, 'draft'),
           'applicantRelationship', COALESCE(r.relationship, 'tenant'),
           'tenantOwnerApproved',
             COALESCE(r.owner_review_status = 'approved', false),

           'isAgreementUploaderWithOpenRequest',
             d.uploaded_by = $1
             AND EXISTS (
               SELECT 1 FROM resident_unit_requests own_request
               WHERE own_request.user_id = $1
                 AND own_request.society_id = d.society_id
                 AND own_request.tenancy_id = d.tenancy_id
                 AND own_request.relationship = 'tenant'
                 AND own_request.status IN ('draft', 'pending', 'changes_requested')
                 AND own_request.owner_review_status <> 'rejected'
             ),

           'isConfirmedAgreementParticipant', EXISTS (
             SELECT 1 FROM resident_unit_requests participant
             WHERE participant.user_id = $1
               AND participant.society_id = d.society_id
               AND participant.tenancy_id = d.tenancy_id
               AND participant.relationship = 'tenant'
               AND participant.status IN ('pending', 'approved')
               AND participant.owner_review_status = 'approved'
               AND participant.owner_reviewed_agreement_id = d.id
           ),

           'participantAccessCurrent', EXISTS (
             SELECT 1 FROM resident_unit_requests participant
             WHERE participant.user_id = $1
               AND participant.society_id = d.society_id
               AND participant.tenancy_id = d.tenancy_id
               AND participant.relationship = 'tenant'
               AND participant.status IN ('pending', 'approved')
               AND participant.owner_review_status = 'approved'
               AND participant.owner_reviewed_agreement_id = d.id
               AND (
                 participant.tenancy_end_date IS NULL
                 OR participant.tenancy_end_date >=
                    (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
               )
               AND (
                 participant.status = 'pending'
                 OR EXISTS (
                   SELECT 1 FROM resident_unit_memberships pm
                   WHERE pm.source_request_id = participant.id
                     AND pm.user_id = $1
                     AND pm.society_id = participant.society_id
                     AND pm.unit_id = participant.unit_id
                     AND pm.relationship = 'tenant'
                     AND pm.status = 'active'
                     AND (
                       pm.tenancy_end_date IS NULL
                       OR pm.tenancy_end_date >=
                          (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
                     )
                 )
               )
           ),

           'tenancyAccessCurrent', COALESCE(
             tenancy.status IN ('draft', 'active')
             AND (
               tenancy.ends_on IS NULL
               OR tenancy.ends_on >=
                  (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
             ),
             false
           )
         ) AS context

       FROM resident_documents d
       JOIN societies s ON s.id = d.society_id
       LEFT JOIN resident_unit_requests r
         ON r.id = d.request_id
        AND r.society_id = d.society_id
        AND r.user_id = d.subject_user_id
       LEFT JOIN resident_tenancies tenancy
         ON tenancy.id = d.tenancy_id
        AND tenancy.society_id = d.society_id

       WHERE d.id = $2
       FOR SHARE OF d`,
      [authenticatedUserId, documentId],
    );

    const document = result.rows[0];
    const basis = document ? documentAccessBasis(document.context) : null;

    if (!document || !basis || !document.contentType) {
      throw new ResidentDocumentAccessError();
    }

    // Records an authorised access request, not proof that a download finished.
    await client.query(
      `INSERT INTO resident_document_events (
         society_id, document_id, actor_user_id, action, access_basis
       ) VALUES ($1, $2, $3, 'access_granted', $4)`,
      [document.societyId, documentId, authenticatedUserId, basis],
    );

    await client.query("COMMIT");
    begun = false;

    return {
      documentId,
      storageBucket: document.storageBucket,
      storageKey: document.storageKey,
      originalFilename: document.originalFilename,
      contentType: document.contentType,
      accessBasis: basis,
    };
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
