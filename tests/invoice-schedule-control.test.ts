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
import { createInvoiceSchedule } from "../src/lib/server/services/invoice-schedules.service";
import { deleteScheduleDraft } from "../src/lib/server/services/invoice-draft-deletion.service";
import {
  prepareScheduleControl,
  controlInvoiceSchedule,
} from "../src/lib/server/services/invoice-schedule-control.service";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import(
  "@next/env"
);

test("recurring schedule control", async (t) => {
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


    const calendar = await pool.query<{ nextMonth: string }>(
      `SELECT to_char(
         date_trunc('month', clock_timestamp() AT TIME ZONE 'Asia/Kolkata')
           + interval '1 month',
         'YYYY-MM'
       ) AS "nextMonth"`,
    );

    const futureMonth = calendar.rows[0].nextMonth;

    const scheduleInput = {
      title: "Monthly society charges",
      frequency: "monthly" as const,
      target: { kind: "unit_type" as const, unitTypeId: oneBhk.id },
      firstBillingMonth: futureMonth,
      finalBillingMonth: null,
      generationDay: 10,
      paymentWindowDays: 7,
      lines: [
        { description: "Water", amount: "100.25" },
        { description: "Common electricity", amount: "199.75" },
      ],
    };

    const created = await createInvoiceSchedule(chairman, society, {
      requestKey: randomUUID(),
      schedule: scheduleInput,
    });

    const scheduleId = created.scheduleId;

    async function state() {
      const result = await pool.query<{
        status: string;
        revision: number;
        nextMonth: string;
      }>(
        `SELECT status, revision,
           to_char(next_billing_month, 'YYYY-MM') AS "nextMonth"
         FROM invoice_schedules WHERE id = $1`,
        [scheduleId],
      );
      return result.rows[0];
    }

    await t.test("inactive society cannot activate a schedule", async () => {
      await assert.rejects(
        prepareScheduleControl(chairman, society, scheduleId, "activate"),
        { code: "SERVICES_INACTIVE" },
      );

      await assert.rejects(
        controlInvoiceSchedule(chairman, society, scheduleId, {
          requestKey: randomUUID(),
          action: "activate",
          reviewFingerprint: "0".repeat(64),
        }),
        { code: "SERVICES_INACTIVE" },
      );

      assert.equal((await state()).status, "draft");
    });

    await t.test("schedule control is isolated by society and role", async () => {
      for (const userId of [otherChairman, admin]) {
        await assert.rejects(
          prepareScheduleControl(userId, society, scheduleId, "activate"),
          { code: "FORBIDDEN" },
        );

        await assert.rejects(
          controlInvoiceSchedule(userId, society, scheduleId, {
            requestKey: randomUUID(),
            action: "activate",
            reviewFingerprint: "0".repeat(64),
          }),
          { code: "FORBIDDEN" },
        );
      }

      await assert.rejects(
        prepareScheduleControl(
          otherChairman, otherSociety, scheduleId, "activate",
        ),
        { code: "SCHEDULE_NOT_FOUND" },
      );
    });

    // Activate only this temporary test society.
    await pool.query(
      "UPDATE societies SET service_status = 'active' WHERE id = $1",
      [society],
    );

    await t.test("review shows the first generation date and current amounts", async () => {
      const review = await prepareScheduleControl(
        chairman, society, scheduleId, "activate",
      );

      assert.equal(review.firstGenerationDate, `${futureMonth}-10`);
      assert.equal(review.recipientCount, 1);
      assert.equal(review.recipientIds[0], firstFlat.id);
      assert.equal(review.amountPerBillPaise, 30000);
      assert.equal(review.combinedAmountPaise, 30000);
      assert.equal(review.paymentWindowDays, 7);
      assert.equal((await state()).status, "draft");
    });

    await t.test("a changed recipient list invalidates confirmation", async () => {
      const review = await prepareScheduleControl(
        chairman, society, scheduleId, "activate",
      );

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
        controlInvoiceSchedule(chairman, society, scheduleId, {
          requestKey: randomUUID(),
          action: "activate",
          reviewFingerprint: review.reviewFingerprint,
        }),
        { code: "REVIEW_CHANGED" },
      );

      assert.equal((await state()).status, "draft");
    });

    let activationRequest: {
      requestKey: string;
      action: "activate";
      reviewFingerprint: string;
    };

    await t.test("concurrent activation retries create one transition", async () => {
      const review = await prepareScheduleControl(
        chairman, society, scheduleId, "activate",
      );

      activationRequest = {
        requestKey: randomUUID(),
        action: "activate",
        reviewFingerprint: review.reviewFingerprint,
      };

      const results = await Promise.all([
        controlInvoiceSchedule(
          chairman, society, scheduleId, activationRequest,
        ),
        controlInvoiceSchedule(
          chairman, society, scheduleId, activationRequest,
        ),
      ]);

      assert.equal(results.filter((result) => !result.replayed).length, 1);
      assert.equal(results.filter((result) => result.replayed).length, 1);

      assert.deepEqual(await state(), {
        status: "active",
        revision: 2,
        nextMonth: futureMonth,
      });

      const events = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
         FROM invoice_schedule_events
         WHERE schedule_id = $1 AND action = 'activated'`,
        [scheduleId],
      );
      assert.equal(events.rows[0].count, 1);

      const bills = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
         FROM society_invoices WHERE society_id = $1`,
        [society],
      );
      assert.equal(bills.rows[0].count, 0);
    });

    await t.test("a request key cannot be reused for a different action", async () => {
      await assert.rejects(
        controlInvoiceSchedule(chairman, society, scheduleId, {
          ...activationRequest!,
          action: "pause",
        }),
        { code: "REQUEST_KEY_CONFLICT" },
      );

      assert.equal((await state()).status, "active");
    });

    await t.test("chairman can pause when society services become inactive", async () => {
      await pool.query(
        "UPDATE societies SET service_status = 'inactive' WHERE id = $1",
        [society],
      );

      const review = await prepareScheduleControl(
        chairman, society, scheduleId, "pause",
      );

      assert.equal(review.firstGenerationDate, null);

      const request = {
        requestKey: randomUUID(),
        action: "pause",
        reviewFingerprint: review.reviewFingerprint,
      };

      await controlInvoiceSchedule(chairman, society, scheduleId, request);

      const retry = await controlInvoiceSchedule(
        chairman, society, scheduleId, request,
      );

      assert.equal(retry.replayed, true);
      assert.equal((await state()).status, "paused");

      await assert.rejects(
        prepareScheduleControl(chairman, society, scheduleId, "resume"),
        { code: "SERVICES_INACTIVE" },
      );
    });

    await t.test("resume restores future billing without generating a bill immediately", async () => {
      await pool.query(
        "UPDATE societies SET service_status = 'active' WHERE id = $1",
        [society],
      );

      const review = await prepareScheduleControl(
        chairman, society, scheduleId, "resume",
      );

      assert.equal(review.firstGenerationDate, `${futureMonth}-10`);

      await controlInvoiceSchedule(chairman, society, scheduleId, {
        requestKey: randomUUID(),
        action: "resume",
        reviewFingerprint: review.reviewFingerprint,
      });

      assert.equal((await state()).status, "active");

      const bills = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
         FROM society_invoices WHERE society_id = $1`,
        [society],
      );
      assert.equal(bills.rows[0].count, 0);
    });

    await t.test("past start dates skip missed months and expired schedules are rejected", async () => {
      const overdue = await createInvoiceSchedule(chairman, society, {
        requestKey: randomUUID(),
        schedule: {
          ...scheduleInput,
          firstBillingMonth: "2000-01",
          generationDay: 1,
        },
      });

      const expected = await pool.query<{ date: string }>(
        `SELECT to_char(
           CASE
             WHEN EXTRACT(DAY FROM
               clock_timestamp() AT TIME ZONE 'Asia/Kolkata') = 1
             THEN date_trunc(
               'month', clock_timestamp() AT TIME ZONE 'Asia/Kolkata'
             )
             ELSE date_trunc(
               'month', clock_timestamp() AT TIME ZONE 'Asia/Kolkata'
             ) + interval '1 month'
           END,
           'YYYY-MM-DD'
         ) AS date`,
      );

      const review = await prepareScheduleControl(
        chairman, society, overdue.scheduleId, "activate",
      );

      assert.equal(review.firstGenerationDate, expected.rows[0].date);

      const expired = await createInvoiceSchedule(chairman, society, {
        requestKey: randomUUID(),
        schedule: {
          ...scheduleInput,
          firstBillingMonth: "2000-01",
          finalBillingMonth: "2000-02",
        },
      });

      await assert.rejects(
        prepareScheduleControl(
          chairman, society, expired.scheduleId, "activate",
        ),
        { code: "SCHEDULE_FINISHED" },
      );
    });

    await t.test("deleted and ended schedules cannot be activated", async () => {
      const disposable = await createInvoiceSchedule(chairman, society, {
        requestKey: randomUUID(),
        schedule: scheduleInput,
      });

      await deleteScheduleDraft(
        chairman, society, disposable.scheduleId,
      );

      await assert.rejects(
        prepareScheduleControl(
          chairman, society, disposable.scheduleId, "activate",
        ),
        { code: "SCHEDULE_NOT_FOUND" },
      );

      await pool.query(
        "UPDATE invoice_schedules SET status = 'ended' WHERE id = $1",
        [scheduleId],
      );

      await assert.rejects(
        prepareScheduleControl(chairman, society, scheduleId, "resume"),
        { code: "INVALID_TRANSITION" },
      );
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
