import assert from "node:assert/strict";
import { test } from "node:test";
import { awayOccupancySchema, occupancyDisplay } from "../src/lib/contracts/occupancy";
import { residentApplicationProfileSchema } from "../src/lib/contracts/resident-profile";

test("occupancy labels distinguish rental readiness from tenant approval", () => {
  for (const code of ["VARR", "VNRR", "UM", "CR", "FO"]) {
    assert.equal(awayOccupancySchema.safeParse(code).success, true);
    assert.equal(occupancyDisplay(code, "unknown").code, code);
  }
  assert.equal(awayOccupancySchema.safeParse("UT").success, false);
  assert.equal(occupancyDisplay("UT", "unknown").label, "Upcoming tenancy");
  assert.equal(awayOccupancySchema.safeParse("OO").success, false);
  assert.equal(occupancyDisplay(undefined, "rented").code, "CR");
  assert.equal(occupancyDisplay(undefined, "vacant").code, "V");
  assert.equal(occupancyDisplay("bad", "unknown").code, "UNK");
});
test("owner occupancy choice survives profile validation; invalid values fail", () => {
  const profile = { firstName: "Owner", lastName: "Test", residesInFlat: false,
    correspondenceSameAsFlat: false, correspondenceAddress: {
      line1: "12 Test Street", line2: "", city: "Pune", state: "Maharashtra", pinCode: "411001",
    }, familyMembers: [], occupancyWhenAway: "VARR" };
  const result = residentApplicationProfileSchema.parse({ relationship: "owner", profile });
  assert.equal(result.profile.occupancyWhenAway, "VARR");
  assert.equal(residentApplicationProfileSchema.safeParse({ relationship: "owner", profile: { ...profile, occupancyWhenAway: "fake" } }).success, false);
  const { occupancyWhenAway: _old, ...historical } = profile;
  void _old;
  assert.equal(residentApplicationProfileSchema.safeParse({ relationship: "owner", profile: historical }).success, true);
});
