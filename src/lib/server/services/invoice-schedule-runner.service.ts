import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { getDatabase } from "@/lib/server/db";
import { withChairmanUnitAccess } from "./units.service";
import {
  prepareInvoiceIssueInTransaction,
  issueInvoiceDraftInTransaction,
} from "./invoice-issuance.service";

type Schedule = {
  id: string;
  title: string;
  status: string;
  revision: number;
  deletedAt: Date | null;
  nextMonth: string;
  finalMonth: string | null;
  generationDay: number;
  paymentWindowDays: number;
  targetKind: "unit" | "unit_type";
  targetUnitId: string | null;
  targetUnitTypeId: string | null;
};

type RunResult = {
  scheduleId: string;
  outcome: "generated" | "skipped" | "ended" | "not_due" | "blocked";
  invoiceCount: number;
  skippedMonths: number;
  reason?: string;
};

async function finishSchedule(
  client: PoolClient,
  societyId: string,
  schedule: Schedule,
  actorId: string,
  nextMonth: string,
  ended: boolean,
) {
  await client.query(
    `UPDATE invoice_schedules
     SET next_billing_month = $3::date,
         status = CASE WHEN $4::boolean THEN 'ended' ELSE status END,
         revision = revision + 1,
         updated_at = clock_timestamp()
     WHERE society_id = $1 AND id = $2`,
    [societyId, schedule.id, nextMonth, ended],
  );

  if (ended) {
    await client.query(
      `INSERT INTO invoice_schedule_events (
         society_id, schedule_id, actor_user_id, action, snapshot
       )
       VALUES ($1, $2, $3, 'ended', $4::jsonb)`,
      [
        societyId,
        schedule.id,
        actorId,
        JSON.stringify({
          source: "recurring_runner",
          reason: "Schedule reached its final billing month.",
          previousRevision: schedule.revision,
        }),
      ],
    );
  }
}

/**
 * Internal worker entry point, not a public API.
 * Rechecks chairman access, service status and schedule state.
 * Uses the same society lock as edits, issuance and schedule controls.
 */
export async function processInvoiceSchedule(
  societyId: string,
  scheduleId: string,
): Promise<RunResult> {
  z.uuid().parse(societyId);
  z.uuid().parse(scheduleId);

  // Locate the current chairman rather than relying on the creator forever.
  // The transaction helper rechecks and locks this user's actual access.
  const chairman = await getDatabase().query<{ userId: string }>(
    `SELECT user_id AS "userId"
     FROM society_memberships
     WHERE society_id = $1 AND role = 'chairman' AND status = 'active'
     ORDER BY id
     LIMIT 1`,
    [societyId],
  );

  const actorId = chairman.rows[0]?.userId;

  if (!actorId) {
    return {
      scheduleId,
      outcome: "blocked",
      invoiceCount: 0,
      skippedMonths: 0,
      reason: "No active chairman membership.",
    };
  }

  return withChairmanUnitAccess(actorId, societyId, async (client) => {
    const selected = await client.query<Schedule>(
      `SELECT
         id, title, status, revision,
         deleted_at AS "deletedAt",
         to_char(next_billing_month, 'YYYY-MM-DD') AS "nextMonth",
         to_char(final_billing_month, 'YYYY-MM-DD') AS "finalMonth",
         generation_day AS "generationDay",
         payment_window_days AS "paymentWindowDays",
         target_kind AS "targetKind",
         target_unit_id AS "targetUnitId",
         target_unit_type_id AS "targetUnitTypeId"
       FROM invoice_schedules
       WHERE society_id = $1 AND id = $2
       FOR UPDATE`,
      [societyId, scheduleId],
    );

    const schedule = selected.rows[0];

    if (!schedule || schedule.deletedAt || schedule.status !== "active") {
      return {
        scheduleId,
        outcome: "not_due",
        invoiceCount: 0,
        skippedMonths: 0,
      };
    }

    const society = await client.query<{ status: string }>(
      "SELECT service_status AS status FROM societies WHERE id = $1",
      [societyId],
    );

    if (society.rows[0]?.status !== "active") {
      return {
        scheduleId,
        outcome: "blocked",
        invoiceCount: 0,
        skippedMonths: 0,
        reason: "Society services are not active.",
      };
    }

    // One reference date for this run, in India Standard Time.
    const calendar = await client.query<{
      today: string;
      currentMonth: string;
      nextMonth: string;
      dueDate: string;
    }>(
      `WITH clock AS (
         SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AS today
       )
       SELECT
         to_char(today, 'YYYY-MM-DD') AS today,
         to_char(date_trunc('month', today), 'YYYY-MM-DD') AS "currentMonth",
         to_char(date_trunc('month', today) + interval '1 month',
                 'YYYY-MM-DD') AS "nextMonth",
         to_char(today + $1::integer, 'YYYY-MM-DD') AS "dueDate"
       FROM clock`,
      [schedule.paymentWindowDays],
    );

    const dates = calendar.rows[0];

    if (schedule.nextMonth > dates.currentMonth) {
      return {
        scheduleId,
        outcome: "not_due",
        invoiceCount: 0,
        skippedMonths: 0,
      };
    }

    const snapshot = JSON.stringify({
      ...schedule,
      source: "recurring_runner",
      authorisedChairmanId: actorId,
    });

    // Record all missed earlier months together, without creating bills.
    // The unique schedule/month constraint also protects these run records.
    const skipped = await client.query(
      `INSERT INTO invoice_schedule_runs (
         society_id, schedule_id, billing_month,
         scheduled_date, due_date, schedule_revision,
         schedule_snapshot, status, skip_reason, recipient_count
       )
       SELECT
         $1, $2, month::date,
         month::date + ($5::integer - 1),
         month::date + ($5::integer - 1) + $6::integer,
         $7, $8::jsonb, 'skipped',
         'Past billing month skipped; no automatic backdated bills.', 0
       FROM generate_series(
         $3::date::timestamp,
         LEAST(
           $4::date - interval '1 month',
           COALESCE($9::date, $4::date)
         ),
         interval '1 month'
       ) AS month
       ON CONFLICT (schedule_id, billing_month) DO NOTHING`,
      [
        societyId,
        scheduleId,
        schedule.nextMonth,
        dates.currentMonth,
        schedule.generationDay,
        schedule.paymentWindowDays,
        schedule.revision,
        snapshot,
        schedule.finalMonth,
      ],
    );

    const skippedMonths = skipped.rowCount ?? 0;

    if (
      schedule.finalMonth !== null &&
      schedule.finalMonth < dates.currentMonth
    ) {
      await finishSchedule(
        client, societyId, schedule, actorId, dates.currentMonth, true,
      );

      return {
        scheduleId,
        outcome: "ended",
        invoiceCount: 0,
        skippedMonths,
      };
    }

    const scheduledDate =
      `${dates.currentMonth.slice(0, 7)}-` +
      String(schedule.generationDay).padStart(2, "0");

    if (scheduledDate > dates.today) {
      if (schedule.nextMonth < dates.currentMonth) {
        await finishSchedule(
          client, societyId, schedule, actorId, dates.currentMonth, false,
        );
      }

      return {
        scheduleId,
        outcome: skippedMonths > 0 ? "skipped" : "not_due",
        invoiceCount: 0,
        skippedMonths,
      };
    }

    const ended =
      schedule.finalMonth !== null &&
      dates.currentMonth >= schedule.finalMonth;

    // Recover safely if a run already exists but its pointer was restored
    // independently. Never issue a second batch for the same month.
    const existing = await client.query(
      `SELECT id FROM invoice_schedule_runs
       WHERE society_id = $1 AND schedule_id = $2 AND billing_month = $3::date`,
      [societyId, scheduleId, dates.currentMonth],
    );

    if (existing.rowCount) {
      await finishSchedule(
        client, societyId, schedule, actorId, dates.nextMonth, ended,
      );

      return {
        scheduleId,
        outcome: ended ? "ended" : "not_due",
        invoiceCount: 0,
        skippedMonths,
        reason: "This billing month was already processed.",
      };
    }

    const condition = schedule.targetKind === "unit"
      ? "id = $2"
      : "unit_type_id = $2";

    const targetId = schedule.targetKind === "unit"
      ? schedule.targetUnitId
      : schedule.targetUnitTypeId;

    const recipients = await client.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count
       FROM society_units
       WHERE society_id = $1 AND ${condition}`,
      [societyId, targetId],
    );

    if (recipients.rows[0].count === 0) {
      await client.query(
        `INSERT INTO invoice_schedule_runs (
           society_id, schedule_id, billing_month,
           scheduled_date, due_date, schedule_revision,
           schedule_snapshot, status, skip_reason, recipient_count
         )
         VALUES (
           $1, $2, $3::date, $4::date, $5::date,
           $6, $7::jsonb, 'skipped', 'No matching flats this month.', 0
         )`,
        [
          societyId, scheduleId, dates.currentMonth,
          scheduledDate, dates.dueDate, schedule.revision, snapshot,
        ],
      );

      await finishSchedule(
        client, societyId, schedule, actorId, dates.nextMonth, ended,
      );

      return {
        scheduleId,
        outcome: "skipped",
        invoiceCount: 0,
        skippedMonths: skippedMonths + 1,
        reason: "No matching flats.",
      };
    }

    // This internal draft and its issuance are never committed separately.
    const draft = await client.query<{ id: string }>(
      `INSERT INTO invoice_drafts (
         society_id, created_by, request_key, title,
         billing_month, due_date,
         target_kind, target_unit_id, target_unit_type_id
       )
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9)
       RETURNING id`,
      [
        societyId, actorId, randomUUID(), schedule.title,
        dates.currentMonth, dates.dueDate,
        schedule.targetKind,
        schedule.targetUnitId,
        schedule.targetUnitTypeId,
      ],
    );

    const draftId = draft.rows[0].id;

    await client.query(
      `INSERT INTO invoice_draft_lines (
         draft_id, position, description, amount_paise
       )
       SELECT $1, position, description, amount_paise
       FROM invoice_schedule_lines
       WHERE schedule_id = $2
       ORDER BY position`,
      [draftId, scheduleId],
    );

    await client.query(
      `INSERT INTO invoice_events (
         society_id, draft_id, actor_user_id, action, snapshot
       )
       VALUES ($1, $2, $3, 'draft_created', $4::jsonb)`,
      [
        societyId, draftId, actorId,
        JSON.stringify({
          source: "recurring_runner",
          scheduleId,
          billingMonth: dates.currentMonth,
        }),
      ],
    );

    const review = await prepareInvoiceIssueInTransaction(
      client, societyId, draftId,
    );

    const issued = await issueInvoiceDraftInTransaction(
      client, actorId, societyId, draftId,
      { reviewFingerprint: review.reviewFingerprint },
    );

    const run = await client.query<{ id: string }>(
      `INSERT INTO invoice_schedule_runs (
         society_id, schedule_id, billing_month,
         scheduled_date, due_date, schedule_revision,
         schedule_snapshot, status, recipient_count, draft_id
       )
       VALUES (
         $1, $2, $3::date, $4::date, $5::date,
         $6, $7::jsonb, 'generated', $8, $9
       )
       RETURNING id`,
      [
        societyId, scheduleId, dates.currentMonth,
        scheduledDate, dates.dueDate, schedule.revision,
        snapshot, issued.invoiceCount, draftId,
      ],
    );

    await client.query(
      `UPDATE society_invoices SET schedule_run_id = $3
       WHERE society_id = $1 AND draft_id = $2`,
      [societyId, draftId, run.rows[0].id],
    );

    await client.query(
      `UPDATE invoice_events
       SET snapshot = snapshot || $3::jsonb
       WHERE society_id = $1 AND draft_id = $2
         AND action = 'invoice_issued'`,
      [
        societyId, draftId,
        JSON.stringify({
          source: "recurring_runner",
          scheduleId,
          scheduleRunId: run.rows[0].id,
        }),
      ],
    );

    await finishSchedule(
      client, societyId, schedule, actorId, dates.nextMonth, ended,
    );

    return {
      scheduleId,
      outcome: "generated",
      invoiceCount: issued.invoiceCount,
      skippedMonths,
    };
  });
}

/**
 * Keyset pagination prevents a blocked schedule from monopolising the batch.
 * Selection is only a hint; processInvoiceSchedule rechecks under locks.
 */
export async function findDueInvoiceSchedules(
  afterId: string | null = null,
  limit = 50,
) {
  if (afterId !== null) z.uuid().parse(afterId);
  z.number().int().min(1).max(100).parse(limit);

  const result = await getDatabase().query<{
    id: string;
    societyId: string;
    nextBillingMonth: string;
  }>(
    `SELECT
       id,
       society_id AS "societyId",
       to_char(next_billing_month, 'YYYY-MM') AS "nextBillingMonth"
     FROM invoice_schedules
     WHERE status = 'active'
       AND deleted_at IS NULL
       AND ($1::uuid IS NULL OR id > $1::uuid)
       AND next_billing_month + (generation_day - 1)
         <= (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
     ORDER BY id
     LIMIT $2`,
    [afterId, limit],
  );

  return result.rows;
}
