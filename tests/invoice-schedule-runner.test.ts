import { getInvoiceSchedule } from "../src/lib/server/services/invoice-schedule-reading.service";
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
import {
  processInvoiceSchedule,
} from "../src/lib/server/services/invoice-schedule-runner.service";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import(
  "@next/env"
);

test("recurring invoice runner", async (t) => {
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


    const calendar = await pool.query<{
      month: string;
      previousMonth: string;
      twoMonthsAgo: string;
      nextMonth: string;
      dueDate: string;
      day: number;
    }>(
      `WITH clock AS (
         SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AS today
       )
       SELECT
         to_char(today, 'YYYY-MM') AS month,
         to_char(today - interval '1 month', 'YYYY-MM') AS "previousMonth",
         to_char(today - interval '2 months', 'YYYY-MM') AS "twoMonthsAgo",
         to_char(today + interval '1 month', 'YYYY-MM') AS "nextMonth",
         to_char(today + 7, 'YYYY-MM-DD') AS "dueDate",
         LEAST(EXTRACT(DAY FROM today)::integer, 28) AS day
       FROM clock`,
    );
    const dates = calendar.rows[0];

    await pool.query(
      "UPDATE societies SET service_status = 'active' WHERE id = $1",
      [society],
    );

    async function makeSchedule(options: {
      status?: "draft" | "active" | "paused";
      firstMonth?: string;
      finalMonth?: string | null;
      unitTypeId?: string;
      day?: number;
    } = {}) {
      const created = await createInvoiceSchedule(chairman, society, {
        requestKey: randomUUID(),
        schedule: {
          title: "Runner test bill",
          frequency: "monthly",
          target: {
            kind: "unit_type",
            unitTypeId: options.unitTypeId ?? oneBhk!.id,
          },
          firstBillingMonth: options.firstMonth ?? dates.month,
          finalBillingMonth: options.finalMonth ?? null,
          generationDay: options.day ?? dates.day,
          paymentWindowDays: 7,
          lines: [
            { description: "Water", amount: "100.25" },
            { description: "Electricity", amount: "199.75" },
          ],
        },
      });

      // Fixture setup only: permit testing overdue schedules directly.
      await pool.query(
        "UPDATE invoice_schedules SET status = $2 WHERE id = $1",
        [created.scheduleId, options.status ?? "active"],
      );

      return created.scheduleId;
    }

    async function runs(scheduleId: string) {
      const result = await pool.query<{
        id: string;
        status: string;
        month: string;
        dueDate: string;
        invoiceCount: number;
        notificationCount: number;
      }>(
        `SELECT r.id, r.status,
           to_char(r.billing_month, 'YYYY-MM') AS month,
           to_char(r.due_date, 'YYYY-MM-DD') AS "dueDate",
           (SELECT COUNT(*)::integer FROM society_invoices i
            WHERE i.schedule_run_id = r.id) AS "invoiceCount",
           (SELECT COUNT(*)::integer
            FROM invoice_notification_outbox o
            JOIN society_invoices i ON i.id = o.invoice_id
            WHERE i.schedule_run_id = r.id) AS "notificationCount"
         FROM invoice_schedule_runs r
         WHERE r.schedule_id = $1
         ORDER BY r.billing_month`,
        [scheduleId],
      );
      return result.rows;
    }

    async function scheduleState(scheduleId: string) {
      const result = await pool.query<{
        status: string;
        nextMonth: string;
      }>(
        `SELECT status,
           to_char(next_billing_month, 'YYYY-MM') AS "nextMonth"
         FROM invoice_schedules WHERE id = $1`,
        [scheduleId],
      );
      return result.rows[0];
    }

    await t.test("a schedule cannot run under another society", async () => {
      const id = await makeSchedule();

      const result = await processInvoiceSchedule(otherSociety, id);

      assert.equal(result.outcome, "not_due");
      assert.equal(result.invoiceCount, 0);
      assert.equal((await runs(id)).length, 0);
      assert.equal((await scheduleState(id)).nextMonth, dates.month);
    });

    await t.test("draft, paused and future schedules produce no bills", async () => {
      for (const options of [
        { status: "draft" as const },
        { status: "paused" as const },
        { firstMonth: dates.nextMonth },
      ]) {
        const id = await makeSchedule(options);
        const result = await processInvoiceSchedule(society, id);

        assert.equal(result.outcome, "not_due");
        assert.equal(result.invoiceCount, 0);
        assert.equal((await runs(id)).length, 0);
      }
    });

    await t.test("concurrent workers generate one monthly batch with notifications", async () => {
      const id = await makeSchedule();

      const results = await Promise.all([
        processInvoiceSchedule(society, id),
        processInvoiceSchedule(society, id),
      ]);

      assert.equal(
        results.filter((result) => result.outcome === "generated").length,
        1,
      );

      const records = await runs(id);
      assert.equal(records.length, 1);
      assert.equal(records[0].status, "generated");
      assert.equal(records[0].invoiceCount, 1);
      assert.equal(records[0].notificationCount, 1);
      assert.equal(records[0].dueDate, dates.dueDate);

      assert.deepEqual(await scheduleState(id), {
        status: "active",
        nextMonth: dates.nextMonth,
      });

      const invoice = await pool.query<{
        amount: string;
        unitId: string;
        flatNumber: string;
      }>(
        `SELECT total_paise::text AS amount,
           unit_id AS "unitId",
           unit_snapshot->>'flatNumber' AS "flatNumber"
         FROM society_invoices WHERE schedule_run_id = $1`,
        [records[0].id],
      );

      assert.equal(invoice.rows[0].amount, "30000");
      assert.equal(invoice.rows[0].unitId, firstFlat.id);
      assert.equal(invoice.rows[0].flatNumber, "001");

      const retry = await processInvoiceSchedule(society, id);
      assert.equal(retry.invoiceCount, 0);
      assert.equal((await runs(id)).length, 1);
    });

    await t.test("inactive services block generation without advancing the schedule", async () => {
      const id = await makeSchedule();

      await pool.query(
        "UPDATE societies SET service_status = 'inactive' WHERE id = $1",
        [society],
      );

      const result = await processInvoiceSchedule(society, id);
      assert.equal(result.outcome, "blocked");
      assert.equal((await runs(id)).length, 0);
      assert.equal((await scheduleState(id)).nextMonth, dates.month);

      await pool.query(
        "UPDATE societies SET service_status = 'active' WHERE id = $1",
        [society],
      );

      assert.equal(
        (await processInvoiceSchedule(society, id)).outcome,
        "generated",
      );
    });

    await t.test("disabled chairman access prevents generation", async () => {
      const id = await makeSchedule();

      await pool.query(
        "UPDATE users SET status = 'disabled' WHERE id = $1",
        [chairman],
      );

      try {
        await assert.rejects(
          processInvoiceSchedule(society, id),
          { code: "FORBIDDEN" },
        );
        assert.equal((await runs(id)).length, 0);
      } finally {
        await pool.query(
          "UPDATE users SET status = 'active' WHERE id = $1",
          [chairman],
        );
      }
    });

    await t.test("missed months are skipped and current bills get a full payment window", async () => {
      const id = await makeSchedule({
        firstMonth: dates.twoMonthsAgo,
        day: 1,
      });

      const result = await processInvoiceSchedule(society, id);
      const records = await runs(id);

      assert.equal(result.outcome, "generated");
      assert.equal(result.skippedMonths, 2);
      assert.deepEqual(
        records.map((row) => [row.month, row.status]),
        [
          [dates.twoMonthsAgo, "skipped"],
          [dates.previousMonth, "skipped"],
          [dates.month, "generated"],
        ],
      );
      assert.equal(records[0].invoiceCount, 0);
      assert.equal(records[1].invoiceCount, 0);
      assert.equal(records[2].dueDate, dates.dueDate);
      assert.equal(records[2].notificationCount, 1);
    });

    await t.test("empty recipient categories are recorded as skipped", async () => {
      const id = await makeSchedule({ unitTypeId: twoBhk.id });
      const result = await processInvoiceSchedule(society, id);
      const records = await runs(id);

      assert.equal(result.outcome, "skipped");
      assert.equal(records.length, 1);
      assert.equal(records[0].invoiceCount, 0);
      assert.equal(records[0].notificationCount, 0);
      assert.equal((await scheduleState(id)).nextMonth, dates.nextMonth);
    });

    await t.test("the final month generates once and then ends the schedule", async () => {
      const id = await makeSchedule({ finalMonth: dates.month });

      assert.equal(
        (await processInvoiceSchedule(society, id)).outcome,
        "generated",
      );
      assert.equal((await scheduleState(id)).status, "ended");

      const retry = await processInvoiceSchedule(society, id);
      assert.equal(retry.outcome, "not_due");
      assert.equal((await runs(id)).length, 1);

      const expired = await makeSchedule({
        firstMonth: dates.twoMonthsAgo,
        finalMonth: dates.previousMonth,
      });

      const result = await processInvoiceSchedule(society, expired);
      assert.equal(result.outcome, "ended");
      assert.equal(result.invoiceCount, 0);
      assert.equal((await runs(expired)).length, 2);
      assert.ok(
        (await runs(expired)).every((row) => row.status === "skipped"),
      );
    });

    await t.test("issuance failure rolls back the internal draft and allows a clean retry", async () => {
      const id = await makeSchedule();

      const previous = await pool.query<{ number: string }>(
        `SELECT last_number::text AS number
         FROM society_invoice_counters WHERE society_id = $1`,
        [society],
      );

      const before = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
         FROM invoice_drafts WHERE society_id = $1`,
        [society],
      );

      await pool.query(
        `UPDATE society_invoice_counters
         SET last_number = 9007199254740991
         WHERE society_id = $1`,
        [society],
      );

      try {
        await assert.rejects(
          processInvoiceSchedule(society, id),
          { code: "NUMBER_LIMIT_REACHED" },
        );

        assert.equal((await runs(id)).length, 0);
        assert.equal((await scheduleState(id)).nextMonth, dates.month);

        const after = await pool.query<{ count: number }>(
          `SELECT COUNT(*)::integer AS count
           FROM invoice_drafts WHERE society_id = $1`,
          [society],
        );
        assert.equal(after.rows[0].count, before.rows[0].count);
      } finally {
        await pool.query(
          `UPDATE society_invoice_counters
           SET last_number = $2::bigint WHERE society_id = $1`,
          [society, previous.rows[0].number],
        );
      }

      const retry = await processInvoiceSchedule(society, id);
      assert.equal(retry.outcome, "generated");
      assert.equal((await runs(id)).length, 1);
    });

    await t.test("history is paginated and preserves generated totals", async () => {
      const earlier = await pool.query<{ month: string }>(
        `SELECT to_char($1::date - interval '22 months', 'YYYY-MM') AS month`,
        [`${dates.month}-01`],
      );

      const id = await makeSchedule({
        firstMonth: earlier.rows[0].month,
        day: 1,
      });

      await processInvoiceSchedule(society, id);

      const first = await getInvoiceSchedule(chairman, society, id, 1);
      assert.equal(first.history.total, 23);
      assert.equal(first.history.totalPages, 2);
      assert.equal(first.history.runs.length, 20);
      assert.equal(first.history.runs[0].billingMonth, dates.month);
      assert.equal(first.history.runs[0].status, "generated");
      assert.equal(first.history.runs[0].recipientCount, 1);
      assert.equal(first.history.runs[0].issuedValuePaise, 30000);

      const second = await getInvoiceSchedule(chairman, society, id, 2);
      assert.equal(second.history.runs.length, 3);
      assert.ok(second.history.runs.every((run) =>
        run.status === "skipped" &&
        run.issuedValuePaise === 0 &&
        run.skipReason !== null
      ));

      const ids = [
        ...first.history.runs.map((run) => run.id),
        ...second.history.runs.map((run) => run.id),
      ];
      assert.equal(new Set(ids).size, 23);

      const beyond = await getInvoiceSchedule(chairman, society, id, 999);
      assert.equal(beyond.history.page, 2);
      assert.equal(beyond.history.runs.length, 3);
    });

    await t.test("history is protected by society access", async () => {
      const id = await makeSchedule();
      await processInvoiceSchedule(society, id);

      await assert.rejects(
        getInvoiceSchedule(otherChairman, society, id),
        { code: "FORBIDDEN" },
      );

      await assert.rejects(
        getInvoiceSchedule(otherChairman, otherSociety, id),
        { code: "SCHEDULE_NOT_FOUND" },
      );

      await assert.rejects(
        getInvoiceSchedule(chairman, society, id, 0),
        { code: "INVALID_PAGE" },
      );
    });

  } finally {
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const statements = [
          "DELETE FROM invoice_notification_outbox WHERE society_id = ANY($1::uuid[])",
          "DELETE FROM invoice_events WHERE society_id = ANY($1::uuid[])",
          "DELETE FROM society_invoices WHERE society_id = ANY($1::uuid[])",
          "DELETE FROM invoice_schedule_runs WHERE society_id = ANY($1::uuid[])",
          `DELETE FROM invoice_draft_lines WHERE draft_id IN (
             SELECT id FROM invoice_drafts WHERE society_id = ANY($1::uuid[])
           )`,
          "DELETE FROM invoice_drafts WHERE society_id = ANY($1::uuid[])",
          "DELETE FROM society_invoice_counters WHERE society_id = ANY($1::uuid[])",
          "DELETE FROM invoice_schedule_events WHERE society_id = ANY($1::uuid[])",
          `DELETE FROM invoice_schedule_lines WHERE schedule_id IN (
             SELECT id FROM invoice_schedules WHERE society_id = ANY($1::uuid[])
           )`,
          "DELETE FROM invoice_schedules WHERE society_id = ANY($1::uuid[])",
          "DELETE FROM unit_events WHERE society_id = ANY($1::uuid[])",
          "DELETE FROM society_units WHERE society_id = ANY($1::uuid[])",
          "DELETE FROM society_unit_types WHERE society_id = ANY($1::uuid[])",
          `DELETE FROM application_events WHERE application_id IN (
             SELECT id FROM society_applications WHERE society_id = ANY($1::uuid[])
           )`,
          "DELETE FROM society_applications WHERE society_id = ANY($1::uuid[])",
          "DELETE FROM society_memberships WHERE society_id = ANY($1::uuid[])",
          "DELETE FROM societies WHERE id = ANY($1::uuid[])",
        ];

        for (const sql of statements) {
          await client.query(sql, [societyIds]);
        }

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
