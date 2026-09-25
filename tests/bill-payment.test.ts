import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateBillPayment } from "../src/lib/contracts/bill-payment";

const base = {
  totalPaise: "10000",
  receivedPaise: "0",
  invoiceStatus: "issued" as const,
  dueDate: "2026-09-24",
  today: "2026-09-25",
};

test("unpaid overdue bill retains its full balance", () => {
  assert.deepEqual(calculateBillPayment(base), {
    paymentStatus: "unpaid",
    outstandingPaise: "10000",
    isOverdue: true,
  });
});

test("partial payment remains overdue for the remaining balance", () => {
  assert.deepEqual(calculateBillPayment({ ...base, receivedPaise: "4000" }), {
    paymentStatus: "part_paid",
    outstandingPaise: "6000",
    isOverdue: true,
  });
});

test("fully paid bills are not overdue", () => {
  assert.deepEqual(calculateBillPayment({ ...base, receivedPaise: "10000" }), {
    paymentStatus: "paid",
    outstandingPaise: "0",
    isOverdue: false,
  });
});

test("bills due today are not overdue", () => {
  assert.equal(
    calculateBillPayment({ ...base, dueDate: base.today }).isOverdue,
    false,
  );
});

test("future bills are not overdue", () => {
  assert.equal(
    calculateBillPayment({ ...base, dueDate: "2026-10-01" }).isOverdue,
    false,
  );
});

test("void bills have no collectible balance", () => {
  assert.deepEqual(calculateBillPayment({ ...base, invoiceStatus: "void" }), {
    paymentStatus: "void",
    outstandingPaise: "0",
    isOverdue: false,
  });
});

test("invalid amounts and dates are rejected", () => {
  assert.throws(() => calculateBillPayment({ ...base, receivedPaise: "10001" }));
  assert.throws(() => calculateBillPayment({ ...base, receivedPaise: "-1" }));
  assert.throws(() => calculateBillPayment({ ...base, totalPaise: "1.5" }));
  assert.throws(() => calculateBillPayment({ ...base, dueDate: "2026-02-30" }));
});
