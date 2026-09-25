import assert from "node:assert/strict";
import { test } from "node:test";
import {
  invoiceDateSchema,
  invoiceDraftSchema,
  rupeeAmountSchema,
} from "../src/lib/contracts/invoices";

const unitId = "123e4567-e89b-42d3-a456-426614174000";

const draft = {
  title: "Monthly maintenance",
  billingMonth: "2026-09",
  dueDate: "2026-10-10",
  target: { kind: "unit" as const, unitId },
  lines: [
    { description: "Maintenance", amount: "2500.10" },
    { description: "Water charges", amount: "99.90" },
  ],
};

test("rupees convert exactly to integer paise", () => {
  assert.equal(rupeeAmountSchema.parse("0.01"), 1);
  assert.equal(rupeeAmountSchema.parse("12.3"), 1230);
  assert.equal(rupeeAmountSchema.parse("2500.10"), 250010);
});

test("invalid or excessive amounts are rejected", () => {
  for (const value of [
    "0", "-1", "1.001", "1e3", "1,000", "NaN", "1000000.01", "",
  ]) {
    assert.equal(rupeeAmountSchema.safeParse(value).success, false, value);
  }
  assert.equal(rupeeAmountSchema.safeParse(100).success, false);
});

test("line amounts determine the total", () => {
  const result = invoiceDraftSchema.parse(draft);
  assert.equal(result.totalPaise, 260000);
  assert.equal(result.lines[0].amountPaise, 250010);
  assert.equal(result.lines[1].amountPaise, 9990);
});

test("client-supplied totals and ownership fields are rejected", () => {
  assert.equal(
    invoiceDraftSchema.safeParse({ ...draft, totalPaise: 1 }).success,
    false,
  );
  assert.equal(
    invoiceDraftSchema.safeParse({ ...draft, societyId: unitId }).success,
    false,
  );
});

test("a target is either a flat or a unit type", () => {
  assert.equal(
    invoiceDraftSchema.safeParse({
      ...draft,
      target: { kind: "unit_type", unitTypeId: unitId },
    }).success,
    true,
  );
  assert.equal(
    invoiceDraftSchema.safeParse({
      ...draft,
      target: { kind: "unit", unitId, unitTypeId: unitId },
    }).success,
    false,
  );
});

test("dates must exist and billing months must be valid", () => {
  assert.equal(invoiceDateSchema.safeParse("2026-02-30").success, false);
  assert.equal(invoiceDateSchema.safeParse("2026-02-29").success, false);
  assert.equal(invoiceDateSchema.safeParse("2028-02-29").success, true);
  assert.equal(
    invoiceDraftSchema.safeParse({ ...draft, billingMonth: "2026-13" }).success,
    false,
  );
});

test("invoices require bounded, plain-text charge descriptions", () => {
  assert.equal(
    invoiceDraftSchema.safeParse({ ...draft, lines: [] }).success,
    false,
  );
  assert.equal(
    invoiceDraftSchema.safeParse({
      ...draft,
      lines: [{ description: "  ", amount: "100" }],
    }).success,
    false,
  );
  assert.equal(
    invoiceDraftSchema.safeParse({
      ...draft,
      lines: Array.from({ length: 21 }, () => draft.lines[0]),
    }).success,
    false,
  );
});
