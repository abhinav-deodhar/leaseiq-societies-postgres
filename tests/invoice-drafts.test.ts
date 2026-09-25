import { createInvoiceSchedule } from "../src/lib/server/services/invoice-schedules.service";
import { listInvoiceSchedules, getInvoiceSchedule } from "../src/lib/server/services/invoice-schedule-reading.service";
import { deleteInvoiceDraft, deleteScheduleDraft } from "../src/lib/server/services/invoice-draft-deletion.service";
import { createInvoiceDraft, updateInvoiceDraft } from "../src/lib/server/services/invoice-drafts.service";
import {
  getInvoiceDraft,
  listInvoiceDrafts,
} from "../src/lib/server/services/invoice-draft-reading.service";
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

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import(
  "@next/env"
);

test("invoice draft database behaviour", async (t) => {
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
        title: "September maintenance",
        billingMonth: "2026-09",
        dueDate: "2026-10-10",
        target: { kind: "unit_type" as const, unitTypeId: oneBhk.id },
        lines: [
          { description: "Maintenance", amount: "2500.10" },
          { description: "Water", amount: "99.90" },
        ],
      },
    };

    let draftId = "";

    async function draftCount() {
      const result = await pool.query<{ count: number }>(
        "SELECT COUNT(*)::integer AS count FROM invoice_drafts WHERE society_id = $1",
        [society],
      );
      return result.rows[0].count;
    }

    await t.test("inactive society can prepare a draft without issuing invoices", async () => {
      const result = await createInvoiceDraft(chairman, society, request);
      draftId = result.draftId;
      assert.equal(result.status, "draft");
      assert.equal(result.replayed, false);

      const detail = await getInvoiceDraft(chairman, society, draftId);
      assert.equal(detail.draft.totalPaise, 260000);
      assert.deepEqual(
        detail.draft.lines.map((line) => line.amountPaise),
        [250010, 9990],
      );
      assert.equal(detail.preview?.recipientCount, 1);
      assert.equal(detail.preview?.combinedAmountPaise, 260000);
      assert.equal(detail.preview?.recipients[0].flatNumber, "001");

      const issued = await pool.query<{ count: number }>(
        "SELECT COUNT(*)::integer AS count FROM society_invoices WHERE society_id = $1",
        [society],
      );
      assert.equal(issued.rows[0].count, 0);
    });

    await t.test("concurrent retries return the same draft without duplicate lines or events", async () => {
      assert.ok(draftId);
      const results = await Promise.all([
        createInvoiceDraft(chairman, society, request),
        createInvoiceDraft(chairman, society, request),
      ]);
      assert.ok(results.every(
        (result) => result.draftId === draftId && result.replayed,
      ));
      assert.equal(await draftCount(), 1);

      const counts = await pool.query<{ lines: number; events: number }>(
        `SELECT
          (SELECT COUNT(*)::integer FROM invoice_draft_lines
           WHERE draft_id = $1) AS lines,
          (SELECT COUNT(*)::integer FROM invoice_events
           WHERE draft_id = $1 AND action = 'draft_created') AS events`,
        [draftId],
      );
      assert.deepEqual(counts.rows[0], { lines: 2, events: 1 });
    });

    await t.test("reusing a request key with different charges is rejected", async () => {
      await assert.rejects(
        createInvoiceDraft(chairman, society, {
          ...request,
          draft: {
            ...request.draft,
            lines: [{ description: "Changed charge", amount: "1.00" }],
          },
        }),
        { code: "REQUEST_KEY_CONFLICT" },
      );
      assert.equal(await draftCount(), 1);
    });

    await t.test("preview reflects newly registered recipients", async () => {
      await createUnitForChairman(
        chairman,
        society,
        createUnitSchema.parse({
          wing: "A",
          flatNumber: "002",
          unitTypeId: oneBhk.id,
        }),
      );

      const detail = await getInvoiceDraft(chairman, society, draftId);
      assert.equal(detail.preview?.recipientCount, 2);
      assert.equal(detail.preview?.combinedAmountPaise, 520000);
      assert.equal(detail.draft.totalPaise, 260000);
    });

    await t.test("single-flat draft targets only that flat", async () => {
      const result = await createInvoiceDraft(chairman, society, {
        ...request,
        requestKey: randomUUID(),
        draft: {
          ...request.draft,
          target: { kind: "unit", unitId: firstFlat.id },
        },
      });

      const detail = await getInvoiceDraft(chairman, society, result.draftId);
      assert.equal(detail.preview?.recipientCount, 1);
      assert.equal(detail.preview?.recipients[0].id, firstFlat.id);
    });

    await t.test("foreign targets and empty categories create no drafts", async () => {
      const foreignFlat = await createUnitForChairman(
        otherChairman,
        otherSociety,
        createUnitSchema.parse({ flatNumber: "101" }),
      );
      const before = await draftCount();

      await assert.rejects(
        createInvoiceDraft(chairman, society, {
          ...request,
          requestKey: randomUUID(),
          draft: {
            ...request.draft,
            target: { kind: "unit", unitId: foreignFlat.id },
          },
        }),
        { code: "INVALID_TARGET" },
      );

      await assert.rejects(
        createInvoiceDraft(chairman, society, {
          ...request,
          requestKey: randomUUID(),
          draft: {
            ...request.draft,
            target: { kind: "unit_type", unitTypeId: twoBhk.id },
          },
        }),
        { code: "NO_RECIPIENTS" },
      );

      assert.equal(await draftCount(), before);
    });

    await t.test("draft access remains isolated by society and role", async () => {
      for (const userId of [otherChairman, admin]) {
        await assert.rejects(
          listInvoiceDrafts(userId, society, 1),
          { code: "FORBIDDEN" },
        );
        await assert.rejects(
          getInvoiceDraft(userId, society, draftId),
          { code: "FORBIDDEN" },
        );
        await assert.rejects(
          createInvoiceDraft(userId, society, {
            ...request, requestKey: randomUUID(),
          }),
          { code: "FORBIDDEN" },
        );
      }

      await assert.rejects(
        getInvoiceDraft(otherChairman, otherSociety, draftId),
        { code: "DRAFT_NOT_FOUND" },
      );

      const own = await listInvoiceDrafts(chairman, society, 1);
      assert.equal(own.total, 2);
      assert.equal(own.drafts.length, 2);

      const foreign = await listInvoiceDrafts(otherChairman, otherSociety, 1);
      assert.equal(foreign.total, 0);
    });

    await t.test("deletion is scoped, idempotent and retains a single audit event", async () => {
      await assert.rejects(deleteInvoiceDraft(otherChairman, society, draftId), { code: "FORBIDDEN" });
      await assert.rejects(deleteInvoiceDraft(otherChairman, otherSociety, draftId), { code: "DRAFT_NOT_FOUND" });
      await Promise.all([deleteInvoiceDraft(chairman, society, draftId), deleteInvoiceDraft(chairman, society, draftId)]);
      const detail = await getInvoiceDraft(chairman, society, draftId);
      assert.equal(detail.draft.status, "cancelled");
      assert.equal(detail.preview, null);
      assert.equal((await listInvoiceDrafts(chairman, society, 1)).total, 1);
      const events = await pool.query("SELECT id FROM invoice_events WHERE draft_id = $1 AND action = 'draft_cancelled'", [draftId]);
      assert.equal(events.rowCount, 1);
      const retry = await createInvoiceDraft(chairman, society, request);
      assert.equal(retry.draftId, draftId);
      assert.equal(retry.status, "cancelled");
    });
    await t.test("an issued draft cannot be deleted", async () => {
      const created = await createInvoiceDraft(chairman, society, { ...request, requestKey: randomUUID() });
      await pool.query("UPDATE invoice_drafts SET status = 'issued', issued_at = clock_timestamp(), issued_by = $2 WHERE id = $1", [created.draftId, chairman]);
      await assert.rejects(deleteInvoiceDraft(chairman, society, created.draftId), { code: "DRAFT_ALREADY_ISSUED" });
      assert.equal((await getInvoiceDraft(chairman, society, created.draftId)).draft.status, "issued");
    });

    await t.test("only schedule drafts can be deleted, with isolation and idempotency", async () => {
      const input = { requestKey: randomUUID(), schedule: {
        title: "Custom monthly bill", frequency: "monthly", target: { kind: "unit", unitId: firstFlat.id },
        firstBillingMonth: "2026-09", finalBillingMonth: null, generationDay: 1, paymentWindowDays: 10,
        lines: [{ description: "Water", amount: "100.00" }],
      }};
      const created = await createInvoiceSchedule(chairman,society,input);
      await assert.rejects(deleteScheduleDraft(otherChairman,society,created.scheduleId),{ code: "FORBIDDEN" });
      await assert.rejects(deleteScheduleDraft(otherChairman,otherSociety,created.scheduleId),{ code: "DRAFT_NOT_FOUND" });
      await Promise.all([deleteScheduleDraft(chairman,society,created.scheduleId),deleteScheduleDraft(chairman,society,created.scheduleId)]);
      assert.equal((await listInvoiceSchedules(chairman,society,1)).total,0);
      await assert.rejects(getInvoiceSchedule(chairman,society,created.scheduleId),{ code: "SCHEDULE_NOT_FOUND" });
      const active = await createInvoiceSchedule(chairman,society,{ ...input,requestKey:randomUUID() });
      await pool.query("UPDATE invoice_schedules SET status='active' WHERE id=$1",[active.scheduleId]);
      await assert.rejects(deleteScheduleDraft(chairman,society,active.scheduleId),{ code: "SCHEDULE_NOT_DRAFT" });
    });


    await t.test("editing a draft replaces its charges and retries create one audit event", async () => {
      const created = await createInvoiceDraft(chairman, society, {
        ...request, requestKey: randomUUID(),
      });
      const before = await getInvoiceDraft(chairman, society, created.draftId);
      const edit = {
        requestKey: randomUUID(),
        expectedRevision: before.draft.revision,
        draft: {
          ...request.draft,
          title: "Updated bill",
          target: { kind: "unit" as const, unitId: firstFlat.id },
          lines: [
            { description: "Water", amount: "120.25" },
            { description: "Electricity", amount: "79.75" },
          ],
        },
      };

      const results = await Promise.all([
        updateInvoiceDraft(chairman, society, created.draftId, edit),
        updateInvoiceDraft(chairman, society, created.draftId, edit),
      ]);

      assert.equal(results.filter((result) => result.replayed).length, 1);
      const after = await getInvoiceDraft(chairman, society, created.draftId);
      assert.equal(after.draft.title, "Updated bill");
      assert.equal(after.draft.revision, before.draft.revision + 1);
      assert.equal(after.draft.totalPaise, 20000);
      assert.equal(after.preview?.recipientCount, 1);
      assert.deepEqual(
        after.draft.lines.map((line) => line.amountPaise),
        [12025, 7975],
      );

      const events = await pool.query(
        "SELECT id FROM invoice_events WHERE draft_id = $1 AND action = 'draft_updated'",
        [created.draftId],
      );
      assert.equal(events.rowCount, 1);

      await assert.rejects(
        updateInvoiceDraft(chairman, society, created.draftId, {
          ...edit,
          draft: { ...edit.draft, title: "Different request" },
        }),
        { code: "REQUEST_KEY_CONFLICT" },
      );
    });

    await t.test("two different edits cannot overwrite the same revision", async () => {
      const created = await createInvoiceDraft(chairman, society, {
        ...request, requestKey: randomUUID(),
      });
      const before = await getInvoiceDraft(chairman, society, created.draftId);

      const results = await Promise.allSettled(
        ["First edit", "Second edit"].map((title) =>
          updateInvoiceDraft(chairman, society, created.draftId, {
            requestKey: randomUUID(),
            expectedRevision: before.draft.revision,
            draft: { ...request.draft, title },
          }),
        ),
      );

      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const failure = results.find((result) => result.status === "rejected");
      assert.ok(failure && failure.status === "rejected");
      assert.equal(failure.reason.code, "REVISION_CONFLICT");

      const after = await getInvoiceDraft(chairman, society, created.draftId);
      assert.equal(after.draft.revision, before.draft.revision + 1);
    });

    await t.test("draft edits enforce society access and reject foreign recipients atomically", async () => {
      const created = await createInvoiceDraft(chairman, society, {
        ...request, requestKey: randomUUID(),
      });
      const before = await getInvoiceDraft(chairman, society, created.draftId);
      const edit = {
        requestKey: randomUUID(),
        expectedRevision: before.draft.revision,
        draft: request.draft,
      };

      for (const userId of [otherChairman, admin]) {
        await assert.rejects(
          updateInvoiceDraft(userId, society, created.draftId, edit),
          { code: "FORBIDDEN" },
        );
      }

      await assert.rejects(
        updateInvoiceDraft(otherChairman, otherSociety, created.draftId, edit),
        { code: "DRAFT_NOT_FOUND" },
      );

      const foreignFlat = await createUnitForChairman(
        otherChairman,
        otherSociety,
        createUnitSchema.parse({ flatNumber: "EDIT-FOREIGN" }),
      );

      await assert.rejects(
        updateInvoiceDraft(chairman, society, created.draftId, {
          ...edit,
          draft: {
            ...request.draft,
            title: "Must not be saved",
            target: { kind: "unit", unitId: foreignFlat.id },
          },
        }),
        { code: "INVALID_TARGET" },
      );

      const after = await getInvoiceDraft(chairman, society, created.draftId);
      assert.deepEqual(after.draft, before.draft);
    });

    await t.test("issued and deleted drafts reject edits", async () => {
      for (const status of ["issued", "cancelled"]) {
        const created = await createInvoiceDraft(chairman, society, {
          ...request, requestKey: randomUUID(),
        });

        if (status === "issued") {
          await pool.query(
            `UPDATE invoice_drafts
             SET status = 'issued', issued_at = clock_timestamp(), issued_by = $2
             WHERE id = $1`,
            [created.draftId, chairman],
          );
        } else {
          await deleteInvoiceDraft(chairman, society, created.draftId);
        }

        const detail = await getInvoiceDraft(chairman, society, created.draftId);
        await assert.rejects(
          updateInvoiceDraft(chairman, society, created.draftId, {
            requestKey: randomUUID(),
            expectedRevision: detail.draft.revision,
            draft: request.draft,
          }),
          { code: "DRAFT_NOT_EDITABLE" },
        );
      }
    });

  } finally {
    try {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
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
