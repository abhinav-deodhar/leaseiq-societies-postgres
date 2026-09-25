import assert from "node:assert/strict";
import { test } from "node:test";
import {
  documentAccessBasis,
  type DocumentAccessContext,
} from "../src/lib/server/services/resident-document-policy";

function context(
  overrides: Partial<DocumentAccessContext> = {},
): DocumentAccessContext {
  return {
    accountEligible: true,
    documentReady: true,
    societyAvailable: true,
    kind: "identity",
    isIdentitySubject: false,
    isVerifiedFlatOwner: false,
    isAuthorisedChairman: false,
    requestStatus: "pending",
    applicantRelationship: "tenant",
    tenantOwnerApproved: false,
    isAgreementUploaderWithOpenRequest: false,
    isConfirmedAgreementParticipant: false,
    participantAccessCurrent: false,
    tenancyAccessCurrent: true,
    ...overrides,
  };
}

test("the applicant can read their own identity document", () => {
  assert.equal(
    documentAccessBasis(context({ isIdentitySubject: true })),
    "self",
  );
});

test("an unrelated resident or roommate cannot read an identity document", () => {
  assert.equal(documentAccessBasis(context()), null);
});

test("the verified owner can review a tenant identity document", () => {
  assert.equal(
    documentAccessBasis(context({ isVerifiedFlatOwner: true })),
    "verified_owner",
  );
});

test("reviewers cannot inspect private drafts or withdrawn requests", () => {
  for (const requestStatus of ["draft", "withdrawn", "rejected"] as const) {
    assert.equal(
      documentAccessBasis(context({
        requestStatus,
        isVerifiedFlatOwner: true,
        isAuthorisedChairman: true,
        tenantOwnerApproved: true,
      })),
      null,
    );
  }
});

test("chairman tenant identity access starts after owner approval", () => {
  assert.equal(
    documentAccessBasis(context({ isAuthorisedChairman: true })),
    null,
  );
  assert.equal(
    documentAccessBasis(context({
      isAuthorisedChairman: true,
      tenantOwnerApproved: true,
    })),
    "chairman_identity_review",
  );
});

test("chairman can review an owner applicant identity document", () => {
  assert.equal(
    documentAccessBasis(context({
      applicantRelationship: "owner",
      isAuthorisedChairman: true,
    })),
    "chairman_identity_review",
  );
});

test("chairman permission never grants access to a rental agreement", () => {
  assert.equal(
    documentAccessBasis(context({
      kind: "rental_agreement",
      isAuthorisedChairman: true,
      tenantOwnerApproved: true,
      requestStatus: "approved",
    })),
    null,
  );
});

test("a chairman who is independently the verified flat owner uses owner access", () => {
  assert.equal(
    documentAccessBasis(context({
      kind: "rental_agreement",
      isAuthorisedChairman: true,
      isVerifiedFlatOwner: true,
    })),
    "verified_owner",
  );
});

test("agreement uploader can inspect their own open-request upload", () => {
  assert.equal(
    documentAccessBasis(context({
      kind: "rental_agreement",
      isAgreementUploaderWithOpenRequest: true,
    })),
    "self",
  );
});

test("a roommate needs agreement-specific confirmation and current access", () => {
  assert.equal(
    documentAccessBasis(context({
      kind: "rental_agreement",
      participantAccessCurrent: true,
    })),
    null,
  );
  assert.equal(
    documentAccessBasis(context({
      kind: "rental_agreement",
      isConfirmedAgreementParticipant: true,
      participantAccessCurrent: true,
    })),
    "agreement_participant",
  );
});

test("removed participants and ended tenancies lose agreement access", () => {
  assert.equal(
    documentAccessBasis(context({
      kind: "rental_agreement",
      isConfirmedAgreementParticipant: true,
      participantAccessCurrent: false,
    })),
    null,
  );
  assert.equal(
    documentAccessBasis(context({
      kind: "rental_agreement",
      isVerifiedFlatOwner: true,
      tenancyAccessCurrent: false,
    })),
    null,
  );
});

test("unverified uploads and ineligible accounts cannot access files", () => {
  for (const overrides of [
    { documentReady: false },
    { accountEligible: false },
  ]) {
    assert.equal(
      documentAccessBasis(context({
        ...overrides,
        isIdentitySubject: true,
        isVerifiedFlatOwner: true,
      })),
      null,
    );
  }
});

test("suspension blocks third-party access but preserves access to one's own ID", () => {
  assert.equal(
    documentAccessBasis(context({
      societyAvailable: false,
      isAuthorisedChairman: true,
      tenantOwnerApproved: true,
    })),
    null,
  );
  assert.equal(
    documentAccessBasis(context({
      societyAvailable: false,
      isIdentitySubject: true,
    })),
    "self",
  );
});

test("no relationship means no agreement access", () => {
  assert.equal(
    documentAccessBasis(context({ kind: "rental_agreement" })),
    null,
  );
});
