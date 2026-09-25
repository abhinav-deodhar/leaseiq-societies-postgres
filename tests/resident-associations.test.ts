import assert from "node:assert/strict";
import { test } from "node:test";
import {
  residentRequestSchema,
  residentRequestSubmissionSchema,
  residentRequestReviewSchema,
  residentMembershipRevocationSchema,
} from "../src/lib/contracts/resident-associations";

const unitId = "123e4567-e89b-42d3-a456-426614174000";

test("owner request normalises omitted optional fields", () => {
  assert.deepEqual(
    residentRequestSchema.parse({ unitId, relationship: "owner" }),
    {
      unitId,
      relationship: "owner",
      moveInDate: null,
      tenancyEndDate: null,
      applicantNote: null,
    },
  );
});

test("tenant request accepts valid dates and trims the note", () => {
  const result = residentRequestSchema.parse({
    unitId,
    relationship: "tenant",
    moveInDate: "2026-09-01",
    tenancyEndDate: "2027-08-31",
    applicantNote: "  Moving into this flat.  ",
  });

  assert.equal(result.applicantNote, "Moving into this flat.");
  assert.equal(result.tenancyEndDate, "2027-08-31");
});

test("blank optional fields become null", () => {
  const result = residentRequestSchema.parse({
    unitId,
    relationship: "tenant",
    moveInDate: "",
    tenancyEndDate: "",
    applicantNote: "   ",
  });

  assert.equal(result.moveInDate, null);
  assert.equal(result.tenancyEndDate, null);
  assert.equal(result.applicantNote, null);
});

test("owner requests cannot include a tenancy end date", () => {
  assert.equal(
    residentRequestSchema.safeParse({
      unitId,
      relationship: "owner",
      moveInDate: "2026-09-01",
      tenancyEndDate: "2027-08-31",
    }).success,
    false,
  );
});

test("tenancy end requires a move-in date and cannot precede it", () => {
  for (const dates of [
    { tenancyEndDate: "2026-09-01" },
    { moveInDate: "2026-09-02", tenancyEndDate: "2026-09-01" },
  ]) {
    assert.equal(
      residentRequestSchema.safeParse({
        unitId,
        relationship: "tenant",
        ...dates,
      }).success,
      false,
    );
  }
});

test("invalid dates, flat identifiers and relationships are rejected", () => {
  for (const fields of [
    { moveInDate: "2026-02-30" },
    { unitId: "invalid" },
    { relationship: "chairman" },
    { applicantNote: "x".repeat(1001) },
  ]) {
    assert.equal(
      residentRequestSchema.safeParse({
        unitId,
        relationship: "owner",
        ...fields,
      }).success,
      false,
    );
  }
});

test("applicants cannot supply approval state or another user identity", () => {
  for (const fields of [
    { status: "approved" },
    { userId: unitId },
    { reviewedBy: unitId },
    { approvedAt: "2026-09-25T00:00:00Z" },
  ]) {
    assert.equal(
      residentRequestSchema.safeParse({
        unitId,
        relationship: "owner",
        ...fields,
      }).success,
      false,
    );
  }
});

test("submission requires a valid revision", () => {
  assert.equal(
    residentRequestSubmissionSchema.safeParse({ expectedRevision: 1 }).success,
    true,
  );

  for (const expectedRevision of [0, -1, 1.5, "1", 2147483648]) {
    assert.equal(
      residentRequestSubmissionSchema.safeParse({ expectedRevision }).success,
      false,
    );
  }
});

test("rejection requires a reason; approval permits an optional note", () => {
  assert.equal(
    residentRequestReviewSchema.safeParse({
      expectedRevision: 1,
      decision: "approved",
    }).success,
    true,
  );

  assert.equal(
    residentRequestReviewSchema.safeParse({
      expectedRevision: 1,
      decision: "rejected",
      reviewNote: "  ",
    }).success,
    false,
  );

  const rejected = residentRequestReviewSchema.parse({
    expectedRevision: 1,
    decision: "rejected",
    reviewNote: "  Please provide the correct supporting document.  ",
  });

  assert.equal(
    rejected.reviewNote,
    "Please provide the correct supporting document.",
  );
});

test("revocation requires a reason and rejects extra fields", () => {
  assert.deepEqual(
    residentMembershipRevocationSchema.parse({ reason: "  Moved out.  " }),
    { reason: "Moved out." },
  );

  for (const input of [
    { reason: "" },
    { reason: "   " },
    { reason: "Moved out.", userId: unitId },
  ]) {
    assert.equal(
      residentMembershipRevocationSchema.safeParse(input).success,
      false,
    );
  }
});
