import assert from "node:assert/strict";
import { test } from "node:test";
import {
  invoiceScheduleSchema,
  createInvoiceScheduleRequestSchema,
} from "../src/lib/contracts/invoice-schedules";

const id = "123e4567-e89b-42d3-a456-426614174000";

const schedule = {
  title: "Shared facilities",
  frequency: "monthly",
  target: { kind: "unit_type", unitTypeId: id },
  firstBillingMonth: "2026-10",
  finalBillingMonth: null,
  generationDay: 1,
  paymentWindowDays: 10,
  lines: [
    { description: "Water", amount: "300.10" },
    { description: "Garden", amount: "199.90" },
  ],
};

test("custom headings are preserved without a predefined bill type", () => {
  const result = invoiceScheduleSchema.parse(schedule);
  assert.equal(result.title, "Shared facilities");
  assert.equal(result.frequency, "monthly");
  assert.equal(result.totalPaise, 50000);
});

test("individual-flat schedules are supported", () => {
  const result = invoiceScheduleSchema.parse({
    ...schedule,
    target: { kind: "unit", unitId: id },
  });
  assert.equal(result.target.kind, "unit");
});

test("ending month may be absent, equal to start, or later", () => {
  for (const finalBillingMonth of [null, "2026-10", "2027-03"]) {
    assert.equal(
      invoiceScheduleSchema.safeParse({
        ...schedule,
        finalBillingMonth,
      }).success,
      true,
    );
  }

  assert.equal(
    invoiceScheduleSchema.safeParse({
      ...schedule,
      finalBillingMonth: "2026-09",
    }).success,
    false,
  );
});

test("generation day and payment window have valid bounds", () => {
  for (const generationDay of [0, 29, 31, 1.5, "1"]) {
    assert.equal(
      invoiceScheduleSchema.safeParse({
        ...schedule,
        generationDay,
      }).success,
      false,
    );
  }

  for (const paymentWindowDays of [0, 91, 1.5, "10"]) {
    assert.equal(
      invoiceScheduleSchema.safeParse({
        ...schedule,
        paymentWindowDays,
      }).success,
      false,
    );
  }
});

test("invalid months and unsupported frequencies are rejected", () => {
  for (const firstBillingMonth of ["2026-13", "2026-1", "0000-01"]) {
    assert.equal(
      invoiceScheduleSchema.safeParse({
        ...schedule,
        firstBillingMonth,
      }).success,
      false,
    );
  }

  assert.equal(
    invoiceScheduleSchema.safeParse({
      ...schedule,
      frequency: "weekly",
    }).success,
    false,
  );
});

test("blank descriptions, invalid prices and empty schedules are rejected", () => {
  for (const lines of [
    [],
    [{ description: "", amount: "10" }],
    [{ description: "Water", amount: "0" }],
    [{ description: "Water", amount: "-10" }],
    [{ description: "Water", amount: "10.001" }],
  ]) {
    assert.equal(
      invoiceScheduleSchema.safeParse({ ...schedule, lines }).success,
      false,
    );
  }
});

test("creation requires a request key and rejects client-supplied status", () => {
  assert.equal(
    createInvoiceScheduleRequestSchema.safeParse({
      requestKey: id,
      schedule,
    }).success,
    true,
  );
  assert.equal(
    createInvoiceScheduleRequestSchema.safeParse({ schedule }).success,
    false,
  );
  assert.equal(
    createInvoiceScheduleRequestSchema.safeParse({
      requestKey: id,
      schedule: { ...schedule, status: "active" },
    }).success,
    false,
  );
});
