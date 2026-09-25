import assert from "node:assert/strict";
import { test } from "node:test";
import { societyApplicationSchema } from "../src/lib/validation/society";

const validApplication = {
  name: "  Green Meadows Society  ",
  addressLine1: "123 Example Road",
  addressLine2: "",
  city: "Pune",
  state: "Maharashtra",
  pinCode: "411001",
  wingCount: 2,
  totalUnits: 30,
  studioUnits: 0,
  oneBhkUnits: 10,
  twoBhkUnits: 15,
  threeBhkUnits: 5,
  fourPlusBhkUnits: 0,
  otherResidentialUnits: 0,
  otherResidentialDescription: "",
};

test("accepts valid society details and normalizes empty optional fields", () => {
  const result = societyApplicationSchema.parse(validApplication);

  assert.equal(result.name, "Green Meadows Society");
  assert.equal(result.addressLine2, null);
  assert.equal(result.otherResidentialDescription, null);
});

test("rejects a mismatch between unit counts and total units", () => {
  const result = societyApplicationSchema.safeParse({
    ...validApplication,
    totalUnits: 31,
  });

  assert.equal(result.success, false);

  if (!result.success) {
    assert.ok(
      result.error.issues.some((issue) => issue.path[0] === "totalUnits"),
    );
  }
});

test("rejects invalid fields and numeric values", () => {
  const invalidChanges = [
    { name: " " },
    { addressLine1: "" },
    { city: "" },
    { state: "Unknown State" },
    { pinCode: "12345" },
    { pinCode: "011001" },
    { wingCount: -1 },
    { wingCount: 1.5 },
    { totalUnits: 0 },
    { oneBhkUnits: -1 },
    { oneBhkUnits: 10.5 },
    { totalUnits: "30" },
  ];

  for (const change of invalidChanges) {
    const result = societyApplicationSchema.safeParse({
      ...validApplication,
      ...change,
    });

    assert.equal(
      result.success,
      false,
      `Expected rejection for: ${Object.keys(change).join(", ")}`,
    );
  }
});

test("requires a description for other residential units", () => {
  const result = societyApplicationSchema.safeParse({
    ...validApplication,
    totalUnits: 31,
    otherResidentialUnits: 1,
  });

  assert.equal(result.success, false);
});

test("accepts described residential units and a building without wings", () => {
  const result = societyApplicationSchema.safeParse({
    ...validApplication,
    wingCount: 0,
    totalUnits: 31,
    otherResidentialUnits: 1,
    otherResidentialDescription: "Residential duplex",
  });

  assert.equal(result.success, true);
});

test("rejects attempts to supply ownership or approval fields", () => {
  for (const extra of [
    { createdBy: "someone-else" },
    { applicantUserId: "someone-else" },
    { status: "approved" },
    { serviceStatus: "active" },
  ]) {
    const result = societyApplicationSchema.safeParse({
      ...validApplication,
      ...extra,
    });

    assert.equal(result.success, false);
  }
});
test("layout requests derive totals on the server and preserve floor details", () => {
  const { name, addressLine1, addressLine2, city, state, pinCode } = validApplication;
  const request = { name, addressLine1, addressLine2, city, state, pinCode,
    residentialLayout: { mode: "layout", buildingType: "wings", wings: [{ name: "A", floorGroups: [{ floors: ["1", "2"], unitsPerFloor: {
      studioUnits: 0, oneBhkUnits: 2, twoBhkUnits: 1, threeBhkUnits: 0, fourPlusBhkUnits: 0,
      customUnits: [{ name: "Duplex", count: 1 }],
    } }] }] },
  };
  const result = societyApplicationSchema.parse(request);
  assert.equal(result.totalUnits, 8);
  assert.equal(result.oneBhkUnits, 4);
  assert.equal(result.otherResidentialUnits, 2);
  assert.equal(result.residentialLayout?.mode, "layout");
  assert.equal(societyApplicationSchema.safeParse({ ...request, totalUnits: 999 }).success, false);
  assert.equal(societyApplicationSchema.safeParse({ ...request, residentialLayout: { ...request.residentialLayout, totals: { totalUnits: 999 } } }).success, false);
});

test("new manual requests derive totals without trusting client totals", () => {
  const { name, addressLine1, addressLine2, city, state, pinCode } = validApplication;
  const result = societyApplicationSchema.parse({ name, addressLine1, addressLine2, city, state, pinCode,
    residentialLayout: { mode: "manual", wingCount: 0, units: {
      studioUnits: 0, oneBhkUnits: 0, twoBhkUnits: 5, threeBhkUnits: 0, fourPlusBhkUnits: 0, customUnits: [],
    } },
  });
  assert.equal(result.totalUnits, 5);
  assert.equal(result.wingCount, 0);
});
