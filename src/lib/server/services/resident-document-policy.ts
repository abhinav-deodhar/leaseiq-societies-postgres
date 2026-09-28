import "server-only";

export type DocumentAccessBasis =
  | "self"
  | "verified_owner"
  | "agreement_participant"
  | "chairman_identity_review";

export type DocumentAccessContext = {
  accountEligible: boolean;
  documentReady: boolean;
  societyAvailable: boolean;
  kind: "identity" | "rental_agreement" | "ownership_proof";

  // Every relationship below must be resolved from the database
  // for this document's exact society, flat, request and tenancy.
  isIdentitySubject: boolean;
  isVerifiedFlatOwner: boolean;
  isAuthorisedChairman: boolean;

  requestStatus: "draft" | "pending" | "approved" | "rejected" | "withdrawn";
  applicantRelationship: "owner" | "tenant";
  tenantOwnerApproved: boolean;

  // Agreement access before approval is limited to the uploader's
  // own open application, or the verified flat owner.
  isAgreementUploaderWithOpenRequest: boolean;

  // Confirmation must refer to this exact agreement version.
  isConfirmedAgreementParticipant: boolean;
  participantAccessCurrent: boolean;
  tenancyAccessCurrent: boolean;
};

export function documentAccessBasis(
  context: DocumentAccessContext,
): DocumentAccessBasis | null {
  if (!context.accountEligible || !context.documentReady) return null;

  if (context.kind === "identity" || context.kind === "ownership_proof") {
    // A person can inspect their own ready identity upload even when
    // their application is rejected or the society is suspended.
    if (context.isIdentitySubject) return "self";

    if (!context.societyAvailable) return null;

    const reviewable =
      context.requestStatus === "pending" ||
      context.requestStatus === "approved";

    if (!reviewable) return null;

    if (
      context.applicantRelationship === "tenant" &&
      context.isVerifiedFlatOwner
    ) {
      return "verified_owner";
    }

    if (
      context.isAuthorisedChairman &&
      (
        context.applicantRelationship === "owner" ||
        context.tenantOwnerApproved
      )
    ) {
      return "chairman_identity_review";
    }

    return null;
  }

  if (!context.societyAvailable || !context.tenancyAccessCurrent) {
    return null;
  }

  if (context.isVerifiedFlatOwner) return "verified_owner";

  if (context.isAgreementUploaderWithOpenRequest) return "self";

  if (
    context.isConfirmedAgreementParticipant &&
    context.participantAccessCurrent
  ) {
    return "agreement_participant";
  }

  // Chairman, security and administrator roles do not grant
  // agreement access. A chairman may qualify separately as owner.
  return null;
}
