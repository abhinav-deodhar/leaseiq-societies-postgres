import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createUnitSchema } from "../src/lib/contracts/units";
import { getDatabase } from "../src/lib/server/db";
import {
  createUnitForChairman,
  listUnitsForChairman,
} from "../src/lib/server/services/units.service";
import { createInvoiceDraft } from "../src/lib/server/services/invoice-drafts.service";
import { deleteInvoiceDraft } from "../src/lib/server/services/invoice-draft-deletion.service";
import {
  prepareInvoiceIssue,
  issueInvoiceDraft,
} from "../src/lib/server/services/invoice-issuance.service";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import(
  "@next/env"
);

test("invoice issuance database behaviour", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");

  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""),
  );
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  const pool = getDatabase();
  const userIds: string[] = [];
  const societyIds: string[] = [];

  async function createUser() {
    const id = randomUUID();

    await pool.query(
      `INSERT INTO users (
         id, full_name, email, phone, date_of_birth,
         status, email_verified_at, phone_verified_at
       )
       VALUES (
         $1, 'Unit Test User', $2, $3, '1990-01-01',
         'active', clock_timestamp(), clock_timestamp()
       )`,
      [
        id,
        `units-${id}@example.invalid`,
        `+919${randomInt(100_000_000, 1_000_000_000)}`,
      ],
    );

    userIds.push(id);
    return id;
  }

  async function createSociety(chairmanId: string, adminId: string) {
    const id = randomUUID();

    await pool.query(
      `INSERT INTO societies (
         id, name, address_line_1, city, state_or_union_territory,
         pin_code, wing_count, total_units, one_bhk_units, created_by
       )
       VALUES (
         $1, 'Unit Test Society', 'Test Street 123',
         'Pune', 'Maharashtra', '411001', 2, 10, 10, $2
       )`,
      [id, chairmanId],
    );
    societyIds.push(id);

    await pool.query(
      `INSERT INTO society_memberships (
         society_id, user_id, role, status
       )
       VALUES ($1, $2, 'chairman', 'active')`,
      [id, chairmanId],
    );

    await pool.query(
      `INSERT INTO society_applications (
         society_id, applicant_user_id, status,
         submitted_at, reviewed_at, reviewed_by
       )
       VALUES (
         $1, $2, 'approved',
         clock_timestamp(), clock_timestamp(), $3
       )`,
      [id, chairmanId, adminId],
    );

    return id;
  }

  try {
    const chairman = await createUser();
    const otherChairman = await createUser();
    const admin = await createUser();

    await pool.query(
      "INSERT INTO platform_admins (user_id) VALUES ($1)",
      [admin],
    );

    const society = await createSociety(chairman, admin);
    const otherSociety = await createSociety(otherChairman, admin);


    const register = await listUnitsForChairman(
      chairman, society, { page: 1, search: "" },
    );
    const oneBhk = register.unitTypes.find(
      (type) => type.category === "one_bhk",
    );
    const twoBhk = register.unitTypes.find(
      (type) => type.category === "two_bhk",
    );
    assert.ok(oneBhk);
    assert.ok(twoBhk);

    const firstFlat = await createUnitForChairman(
      chairman,
      society,
      createUnitSchema.parse({
        wing: "A",
        flatNumber: "001",
        unitTypeId: oneBhk.id,
      }),
    );


    const request = {
      requestKey: randomUUID(),
      draft: {
        title: "Monthly society charges",
        billingMonth: "2026-09",
        dueDate: "2026-10-10",
        target: { kind: "unit_type" as const, unitTypeId: oneBhk.id },
        lines: [
          { description: "Water", amount: "100.25" },
          { description: "Common electricity", amount: "199.75" },
        ],
      },
    };

    const created = await createInvoiceDraft(chairman, society, request);
    const draftId = created.draftId;

    async function counts() {
      const result = await pool.query<{
        invoices: number;
        notifications: number;
        events: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::integer FROM society_invoices
            WHERE society_id = $1 AND draft_id = $2) AS invoices,
           (SELECT COUNT(*)::integer
            FROM invoice_notification_outbox o
            JOIN society_invoices i ON i.id = o.invoice_id
            WHERE i.society_id = $1 AND i.draft_id = $2)
            AS notifications,
           (SELECT COUNT(*)::integer FROM invoice_events
            WHERE society_id = $1 AND draft_id = $2
              AND action = 'invoice_issued') AS events`,
        [society, draftId],
      );
      return result.rows[0];
    }

    await t.test("inactive society cannot review or issue bills", async () => {
      await assert.rejects(
        prepareInvoiceIssue(chairman, society, draftId),
        { code: "SERVICES_INACTIVE" },
      );

      await assert.rejects(
        issueInvoiceDraft(chairman, society, draftId, {
          reviewFingerprint: "0".repeat(64),
        }),
        { code: "SERVICES_INACTIVE" },
      );

      assert.deepEqual(await counts(), {
        invoices: 0, notifications: 0, events: 0,
      });
    });

    // Activate only this test society.
    await pool.query(
      "UPDATE societies SET service_status = 'active' WHERE id = $1",
      [society],
    );

    await t.test("review calculates the complete billing batch", async () => {
      const review = await prepareInvoiceIssue(chairman, society, draftId);

      assert.equal(review.recipientCount, 1);
      assert.equal(review.amountPerBillPaise, 30000);
      assert.equal(review.combinedAmountPaise, 30000);
      assert.equal(review.recipients[0].id, firstFlat.id);
      assert.match(review.reviewFingerprint, /^[0-9a-f]{64}$/);
      assert.deepEqual(await counts(), {
        invoices: 0, notifications: 0, events: 0,
      });
    });

    await t.test("changed recipients require another review", async () => {
      const previous = await prepareInvoiceIssue(chairman, society, draftId);

      await createUnitForChairman(
        chairman,
        society,
        createUnitSchema.parse({
          wing: "A",
          flatNumber: "002",
          unitTypeId: oneBhk.id,
        }),
      );

      await assert.rejects(
        issueInvoiceDraft(chairman, society, draftId, {
          reviewFingerprint: previous.reviewFingerprint,
        }),
        { code: "REVIEW_CHANGED" },
      );

      assert.deepEqual(await counts(), {
        invoices: 0, notifications: 0, events: 0,
      });

      const updated = await prepareInvoiceIssue(chairman, society, draftId);
      assert.equal(updated.recipientCount, 2);
      assert.equal(updated.combinedAmountPaise, 60000);
    });

    await t.test("changed charges invalidate the previous review", async () => {
      const previous = await prepareInvoiceIssue(chairman, society, draftId);

      await pool.query(
        `UPDATE invoice_draft_lines
         SET amount_paise = amount_paise + 100
         WHERE draft_id = $1 AND position = 1`,
        [draftId],
      );

      await assert.rejects(
        issueInvoiceDraft(chairman, society, draftId, {
          reviewFingerprint: previous.reviewFingerprint,
        }),
        { code: "REVIEW_CHANGED" },
      );

      await pool.query(
        `UPDATE invoice_draft_lines
         SET amount_paise = amount_paise - 100
         WHERE draft_id = $1 AND position = 1`,
        [draftId],
      );

      assert.equal((await counts()).invoices, 0);
    });

    await t.test("another chairman or an admin cannot issue these bills", async () => {
      const review = await prepareInvoiceIssue(chairman, society, draftId);

      for (const userId of [otherChairman, admin]) {
        await assert.rejects(
          prepareInvoiceIssue(userId, society, draftId),
          { code: "FORBIDDEN" },
        );

        await assert.rejects(
          issueInvoiceDraft(userId, society, draftId, {
            reviewFingerprint: review.reviewFingerprint,
          }),
          { code: "FORBIDDEN" },
        );
      }

      await assert.rejects(
        prepareInvoiceIssue(otherChairman, otherSociety, draftId),
        { code: "DRAFT_NOT_FOUND" },
      );
    });

    await t.test("concurrent issuance creates one bill and notification per flat", async () => {
      const review = await prepareInvoiceIssue(chairman, society, draftId);
      const input = { reviewFingerprint: review.reviewFingerprint };

      const results = await Promise.all([
        issueInvoiceDraft(chairman, society, draftId, input),
        issueInvoiceDraft(chairman, society, draftId, input),
      ]);

      assert.equal(results.filter((result) => !result.replayed).length, 1);
      assert.equal(results.filter((result) => result.replayed).length, 1);
      assert.ok(results.every((result) => result.invoiceCount === 2));

      assert.deepEqual(await counts(), {
        invoices: 2, notifications: 2, events: 2,
      });

      const bills = await pool.query<{
        number: string;
        amount: string;
        unitId: string;
      }>(
        `SELECT invoice_number::text AS number,
                total_paise::text AS amount,
                unit_id AS "unitId"
         FROM society_invoices
         WHERE society_id = $1 AND draft_id = $2
         ORDER BY invoice_number`,
        [society, draftId],
      );

      assert.deepEqual(bills.rows.map((bill) => bill.number), ["1", "2"]);
      assert.ok(bills.rows.every((bill) => bill.amount === "30000"));
      assert.equal(new Set(bills.rows.map((bill) => bill.unitId)).size, 2);

      const status = await pool.query(
        "SELECT status, issued_by FROM invoice_drafts WHERE id = $1",
        [draftId],
      );
      assert.equal(status.rows[0].status, "issued");
      assert.equal(status.rows[0].issued_by, chairman);
    });

    await t.test("issued bills preserve their original flat details", async () => {
      await pool.query(
        "UPDATE society_units SET flat_number = '001-renamed' WHERE id = $1",
        [firstFlat.id],
      );

      const saved = await pool.query<{
        flatNumber: string;
        lines: Array<{ description: string; amountPaise: number }>;
      }>(
        `SELECT unit_snapshot->>'flatNumber' AS "flatNumber",
                lines_snapshot AS lines
         FROM society_invoices
         WHERE society_id = $1 AND draft_id = $2 AND unit_id = $3`,
        [society, draftId, firstFlat.id],
      );

      assert.equal(saved.rows[0].flatNumber, "001");
      assert.equal(saved.rows[0].lines[0].description, "Water");
      assert.equal(saved.rows[0].lines[0].amountPaise, 10025);

      await assert.rejects(
        deleteInvoiceDraft(chairman, society, draftId),
        { code: "DRAFT_ALREADY_ISSUED" },
      );
    });

    await t.test("a deleted draft cannot be issued", async () => {
      const disposable = await createInvoiceDraft(chairman, society, {
        ...request,
        requestKey: randomUUID(),
      });

      const review = await prepareInvoiceIssue(
        chairman, society, disposable.draftId,
      );

      await deleteInvoiceDraft(chairman, society, disposable.draftId);

      await assert.rejects(
        issueInvoiceDraft(chairman, society, disposable.draftId, {
          reviewFingerprint: review.reviewFingerprint,
        }),
        { code: "DRAFT_NOT_EDITABLE" },
      );
    });

    await t.test("number exhaustion leaves the draft and existing bills unchanged", async () => {
      const next = await createInvoiceDraft(chairman, society, {
        ...request,
        requestKey: randomUUID(),
      });
      const review = await prepareInvoiceIssue(
        chairman, society, next.draftId,
      );

      await pool.query(
        `UPDATE society_invoice_counters
         SET last_number = 9007199254740990
         WHERE society_id = $1`,
        [society],
      );

      await assert.rejects(
        issueInvoiceDraft(chairman, society, next.draftId, {
          reviewFingerprint: review.reviewFingerprint,
        }),
        { code: "NUMBER_LIMIT_REACHED" },
      );

      const unchanged = await pool.query(
        `SELECT
           d.status,
           (SELECT COUNT(*)::integer FROM society_invoices
            WHERE draft_id = d.id) AS count
         FROM invoice_drafts d WHERE d.id = $1`,
        [next.draftId],
      );

      assert.equal(unchanged.rows[0].status, "draft");
      assert.equal(unchanged.rows[0].count, 0);
      assert.deepEqual(await counts(), {
        invoices: 2, notifications: 2, events: 2,
      });
    });

  } finally {
    try {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM invoice_notification_outbox WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );

        await client.query("DELETE FROM invoice_schedule_events WHERE society_id = ANY($1::uuid[])", [societyIds]);
        await client.query("DELETE FROM invoice_schedule_lines WHERE schedule_id IN (SELECT id FROM invoice_schedules WHERE society_id = ANY($1::uuid[]))", [societyIds]);
        await client.query("DELETE FROM invoice_schedules WHERE society_id = ANY($1::uuid[])", [societyIds]);
        await client.query(
          "DELETE FROM invoice_events WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM society_invoices WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          `DELETE FROM invoice_draft_lines WHERE draft_id IN (
             SELECT id FROM invoice_drafts
             WHERE society_id = ANY($1::uuid[])
           )`,
          [societyIds],
        );
        await client.query(
          "DELETE FROM invoice_drafts WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM society_invoice_counters WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );

        await client.query(
          "DELETE FROM unit_events WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM society_units WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM society_unit_types WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          `DELETE FROM application_events WHERE application_id IN (
             SELECT id FROM society_applications
             WHERE society_id = ANY($1::uuid[])
           )`,
          [societyIds],
        );
        await client.query(
          "DELETE FROM society_applications WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM society_memberships WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM societies WHERE id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM platform_admins WHERE user_id = ANY($1::uuid[])",
          [userIds],
        );
        await client.query(
          "DELETE FROM users WHERE id = ANY($1::uuid[])",
          [userIds],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  }
});
