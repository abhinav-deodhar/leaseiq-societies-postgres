import assert from "node:assert/strict";
import { test } from "node:test";
import {
  residentApplicationProfileSchema,
  residentFamilyMemberSchema,
  residentProfileSchema,
} from "../src/lib/contracts/resident-profile";

function profile() {
  return {
    firstName: "Abhinav",
    lastName: "Deodhar",
    residesInFlat: true,
    correspondenceSameAsFlat: true,
    correspondenceAddress: {
      line1: "", line2: "", city: "", state: "", pinCode: "",
    },
    familyMembers: [],
  };
}

const member = {
  firstName: "Family",
  lastName: "Member",
  relationshipToOwner: "Child",
};

test("a family record needs no email, phone or login account", () => {
  const result = residentFamilyMemberSchema.parse(member);
  assert.equal(result.email, "");
  assert.equal(result.phone, "");
});

test("names are trimmed and a single-name person is supported", () => {
  const result = residentProfileSchema.parse({
    ...profile(), firstName: "  Arun  ", lastName: "",
  });
  assert.equal(result.firstName, "Arun");
  assert.equal(result.lastName, "");
});

test("family contacts are normalised and invalid values rejected", () => {
  const result = residentFamilyMemberSchema.parse({
    ...member, email: "  PERSON@EXAMPLE.COM  ", phone: "9876543210",
  });
  assert.equal(result.email, "person@example.com");
  assert.equal(result.phone, "+919876543210");

  for (const extra of [
    { email: "wrong" },
    { phone: "+12025550123" },
    { phone: "123" },
  ]) {
    assert.equal(
      residentFamilyMemberSchema.safeParse({ ...member, ...extra }).success,
      false,
    );
  }
});

test("a nonresident owner must provide a separate complete address", () => {
  const base = { ...profile(), residesInFlat: false };
  assert.equal(residentProfileSchema.safeParse(base).success, false);
  assert.equal(residentProfileSchema.safeParse({
    ...base, correspondenceSameAsFlat: false,
  }).success, false);

  assert.equal(residentProfileSchema.safeParse({
    ...base,
    correspondenceSameAsFlat: false,
    correspondenceAddress: {
      line1: "12 Example Road", line2: "",
      city: "Pune", state: "Maharashtra", pinCode: "411001",
    },
  }).success, true);
});

test("family details are permitted only for a resident owner", () => {
  const withFamily = { ...profile(), familyMembers: [member] };

  assert.equal(residentApplicationProfileSchema.safeParse({
    relationship: "owner", profile: withFamily,
  }).success, true);

  assert.equal(residentApplicationProfileSchema.safeParse({
    relationship: "tenant", profile: withFamily,
  }).success, false);

  assert.equal(residentProfileSchema.safeParse({
    ...withFamily, residesInFlat: false,
  }).success, false);
});

test("family input cannot grant access or attach a login account", () => {
  for (const extra of [
    { userId: "another-user" },
    { approved: true },
    { phoneVerified: true },
    { role: "owner" },
  ]) {
    assert.equal(
      residentFamilyMemberSchema.safeParse({ ...member, ...extra }).success,
      false,
    );
  }
});

test("duplicate nonempty contacts and oversized households are rejected", () => {
  for (const contact of [
    { phone: "9876543210" },
    { email: "person@example.com" },
  ]) {
    assert.equal(residentProfileSchema.safeParse({
      ...profile(),
      familyMembers: [
        { ...member, ...contact },
        { ...member, firstName: "Another", ...contact },
      ],
    }).success, false);
  }

  assert.equal(residentProfileSchema.safeParse({
    ...profile(), familyMembers: Array.from({ length: 21 }, () => member),
  }).success, false);
});
