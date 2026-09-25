import { getIssuedBillDetailInTransaction } from "../src/lib/server/services/issued-bill-detail.service";
import { getBillingSummaryInTransaction } from "../src/lib/server/services/billing-summary.service";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { getDatabase } from "../src/lib/server/db";
import { getFlatBillsInTransaction, listFlatBillingInTransaction } from "../src/lib/server/services/flat-billing.service";
const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as typeof import("@next/env");

test("flat billing and confirmed receipt ledger", async (t) => {
  assert.notEqual(process.env.NODE_ENV,"production"); loadEnvConfig(process.cwd(),true);
  assert.equal(process.env.PGDATABASE,"leaseiq_societies_dev");
  assert.ok(["localhost","127.0.0.1","::1"].includes(process.env.PGHOST??""));
  const pool=getDatabase(); const c=await pool.connect();
  const user=randomUUID(), society=randomUUID(), unit=randomUUID(), draft=randomUUID(), invoice=randomUUID();
  try {
    await c.query("BEGIN");
    await c.query(`INSERT INTO users(id,full_name,email,phone,date_of_birth,status,email_verified_at,phone_verified_at)
      VALUES($1,'Billing Test',$2,$3,'1990-01-01','active',now(),now())`,[user,`${user}@example.invalid`,`+919${randomInt(100000000,1000000000)}`]);
    await c.query(`INSERT INTO societies(id,name,address_line_1,city,state_or_union_territory,pin_code,wing_count,total_units,one_bhk_units,created_by)
      VALUES($1,'Billing Test','Test Address','Pune','Maharashtra','411001',1,1,1,$2)`,[society,user]);
    await c.query("INSERT INTO society_units(id,society_id,wing,flat_number,created_by,occupancy_status) VALUES($1,$2,'A','001',$3,'rented')",[unit,society,user]);
    await c.query(`INSERT INTO invoice_drafts(id,society_id,created_by,request_key,title,billing_month,due_date,target_kind,target_unit_id)
      VALUES($1,$2,$3,$4,'Custom bill','2026-09-01','2026-09-01','unit',$5)`,[draft,society,user,randomUUID(),unit]);
    await c.query(`INSERT INTO society_invoices(id,society_id,draft_id,unit_id,invoice_number,title,billing_month,due_date,total_paise,society_snapshot,unit_snapshot,lines_snapshot,issued_by)
      VALUES($1,$2,$3,$4,1,'Custom bill','2026-09-01','2026-09-01',10000,'{}','{}','[{"description":"Water","amountPaise":10000}]',$5)`,[invoice,society,draft,unit,user]);
    await c.query(`INSERT INTO unit_billing_contacts(society_id,unit_id,full_name,role,starts_on,created_by)
      VALUES($1,$2,'Owner Example','owner','2020-01-01',$3),($1,$2,'Tenant Example','tenant','2020-01-01',$3)`,[society,unit,user]);
    await c.query(
      `UPDATE society_invoices
       SET due_date = (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date - 1
       WHERE id = $1`,
      [invoice],
    );

    await t.test("billing summary counts unpaid and overdue bills", async () => {
      const summary = await getBillingSummaryInTransaction(c, society);
      assert.deepEqual(summary.paid, { billCount: 0, amountPaise: "0" });
      assert.deepEqual(summary.outstanding, { billCount: 1, amountPaise: "10000" });
      assert.deepEqual(summary.overdue, { billCount: 1, amountPaise: "10000" });
      assert.equal(summary.flatsOwingCount, 1);

      const foreign = await getBillingSummaryInTransaction(c, randomUUID());
      assert.equal(foreign.outstanding.billCount, 0);
      assert.equal(foreign.outstanding.amountPaise, "0");
      assert.equal(foreign.flatsOwingCount, 0);
    });

    await t.test("summary excludes void bills and does not mark today overdue", async () => {
      await c.query("SAVEPOINT summary_cases");
      try {
        await c.query(
          `UPDATE society_invoices
           SET due_date = (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
           WHERE id = $1`,
          [invoice],
        );
        const today = await getBillingSummaryInTransaction(c, society);
        assert.equal(today.overdue.billCount, 0);
        assert.equal(today.outstanding.billCount, 1);

        await c.query(
          `UPDATE society_invoices
           SET status = 'void',
               voided_at = clock_timestamp(),
               voided_by = $2,
               void_reason = 'Billing summary test'
           WHERE id = $1`,
          [invoice, user],
        );
        const voided = await getBillingSummaryInTransaction(c, society);
        assert.equal(voided.outstanding.billCount, 0);
        assert.equal(voided.paid.billCount, 0);
        assert.equal(voided.flatsOwingCount, 0);
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT summary_cases");
        await c.query("RELEASE SAVEPOINT summary_cases");
      }
    });

    await t.test("names, occupancy and flat billing are searchable without mixing societies",async()=>{
      const data=await listFlatBillingInTransaction(c,society,1,"Owner Example",false);
      assert.equal(data.total,1);assert.equal(data.flats[0].occupancy,"rented");
      assert.deepEqual(data.flats[0].owners,["Owner Example"]);assert.deepEqual(data.flats[0].tenants,["Tenant Example"]);
      assert.equal(data.flats[0].billedPaise,"10000");assert.equal(data.flats[0].receivedPaise,"0");
      assert.equal((await listFlatBillingInTransaction(c,randomUUID(),1,"",false)).total,0);
      assert.equal(await getFlatBillsInTransaction(c,randomUUID(),unit,1,false),null);
      assert.equal((await listFlatBillingInTransaction(c,society,1,"",true)).total,0);
    });
    await t.test("partial receipts do not mark a bill paid",async()=>{
      await c.query("INSERT INTO invoice_receipts(society_id,invoice_id,amount_paise,source,reference,paid_at,recorded_by) VALUES($1,$2,4000,'manual','part-1',now(),$3)",[society,invoice,user]);
      const data=await getFlatBillsInTransaction(c,society,unit,1,false);
      assert.equal(data?.bills[0].status,"Part-paid");assert.equal(data?.bills[0].receivedPaise,"4000");
      // Partial-payment filter checks
      assert.equal(data?.bills[0].isOverdue, true);
      assert.equal(data?.bills[0].outstandingPaise, "6000");

      for (const filter of ["outstanding", "overdue"] as const) {
        const flats = await listFlatBillingInTransaction(c, society, 1, "", filter);
        assert.equal(flats.total, 1);
        assert.equal(flats.flats[0].outstandingCount, 1);
        assert.equal(flats.flats[0].overdueCount, 1);

        const bills = await getFlatBillsInTransaction(c, society, unit, 1, filter);
        assert.equal(bills?.bills.length, 1);
        assert.equal(bills?.bills[0].outstandingPaise, "6000");

        assert.equal(
          (await listFlatBillingInTransaction(c, randomUUID(), 1, "", filter)).total,
          0,
        );
      }
      assert.equal(
        (await listFlatBillingInTransaction(c, society, 1, "", "paid")).total,
        0,
      );

      assert.equal((await getFlatBillsInTransaction(c,society,unit,1,true))?.bills.length,0);
      const summary = await getBillingSummaryInTransaction(c, society);
      assert.equal(summary.paid.billCount, 0);
      assert.deepEqual(summary.outstanding, { billCount: 1, amountPaise: "6000" });
      assert.deepEqual(summary.overdue, { billCount: 1, amountPaise: "6000" });

    });
    await t.test("full payment appears in both paid-bill views",async()=>{
      await c.query("INSERT INTO invoice_receipts(society_id,invoice_id,amount_paise,source,reference,paid_at,recorded_by) VALUES($1,$2,6000,'manual','part-2',now(),$3)",[society,invoice,user]);
      const data=await listFlatBillingInTransaction(c,society,1,"Tenant Example",true);
      assert.equal(data.flats[0].paidCount,1);assert.equal(data.flats[0].receivedPaise,"10000");
      assert.equal((await getFlatBillsInTransaction(c,society,unit,1,true))?.bills[0].status,"Paid");
      for (const filter of ["outstanding", "overdue"] as const) {
        assert.equal(
          (await listFlatBillingInTransaction(c, society, 1, "", filter)).total,
          0,
        );
        assert.equal(
          (await getFlatBillsInTransaction(c, society, unit, 1, filter))?.bills.length,
          0,
        );
      }

      const summary = await getBillingSummaryInTransaction(c, society);
      assert.deepEqual(summary.paid, { billCount: 1, amountPaise: "10000" });
      assert.equal(summary.outstanding.billCount, 0);
      assert.equal(summary.overdue.billCount, 0);
      assert.equal(summary.flatsOwingCount, 0);

    });
    await t.test("overpayment is rejected and reversal restores outstanding balance",async()=>{
      await c.query("SAVEPOINT overpayment");
      await assert.rejects(c.query("INSERT INTO invoice_receipts(society_id,invoice_id,amount_paise,source,reference,paid_at,recorded_by) VALUES($1,$2,1,'manual','excess',now(),$3)",[society,invoice,user]),/exceeds/);
      await c.query("ROLLBACK TO SAVEPOINT overpayment");
      await c.query("UPDATE invoice_receipts SET reversed_at=clock_timestamp(),reversal_reason='Test reversal' WHERE society_id=$1 AND reference='part-2'",[society]);
      assert.equal((await listFlatBillingInTransaction(c,society,1,"",true)).total,0);
      assert.equal((await getFlatBillsInTransaction(c,society,unit,1,false))?.bills[0].receivedPaise,"4000");
      const summary = await getBillingSummaryInTransaction(c, society);
      assert.equal(summary.paid.billCount, 0);
      assert.equal(summary.outstanding.amountPaise, "6000");
      assert.equal(summary.overdue.amountPaise, "6000");

    });

    await t.test("issued bill detail uses saved charges and scopes invoice lookup", async () => {
      const detail = await getIssuedBillDetailInTransaction(c, society, invoice);
      assert.ok(detail);
      assert.equal(detail.invoice.number, "1");
      assert.equal(detail.invoice.totalPaise, "10000");
      assert.deepEqual(detail.invoice.lines, [
        { description: "Water", amountPaise: "10000" },
      ]);
      assert.equal(
        await getIssuedBillDetailInTransaction(c, randomUUID(), invoice),
        null,
      );
      assert.equal(
        await getIssuedBillDetailInTransaction(c, society, randomUUID()),
        null,
      );
    });

    await t.test("bill detail retains reversed receipts without counting their amounts", async () => {
      const detail = await getIssuedBillDetailInTransaction(c, society, invoice);
      assert.ok(detail);
      assert.equal(detail.invoice.receivedPaise, "4000");
      assert.equal(detail.invoice.outstandingPaise, "6000");
      assert.equal(detail.invoice.paymentStatus, "part_paid");
      assert.equal(detail.invoice.isOverdue, true);
      assert.equal(detail.receipts.total, 2);
      assert.equal(detail.receipts.items.length, 2);

      const reversed = detail.receipts.items.find(item => item.reference === "part-2");
      assert.ok(reversed?.reversedAt);
      assert.equal(reversed.reversalReason, "Test reversal");

      const next = await getIssuedBillDetailInTransaction(c, society, invoice, 2);
      assert.ok(next);
      assert.equal(next.receipts.total, 2);
      assert.equal(next.receipts.items.length, 0);
      assert.equal(next.invoice.receivedPaise, "4000");
    });

    await t.test("receipt amounts cannot be edited after confirmation",async()=>{
      await c.query("SAVEPOINT edit_receipt");
      await assert.rejects(c.query("UPDATE invoice_receipts SET amount_paise=1 WHERE society_id=$1 AND reference='part-1'",[society]),/reversal/);
      await c.query("ROLLBACK TO SAVEPOINT edit_receipt");
    });
  } finally { await c.query("ROLLBACK"); c.release(); await pool.end(); }
});
