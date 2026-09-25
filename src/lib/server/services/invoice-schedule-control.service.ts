import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { withChairmanUnitAccess } from "./units.service";
import { InvoiceScheduleError } from "./invoice-schedules.service";

const actionSchema = z.enum(["activate", "pause", "resume"]);
type Action = z.infer<typeof actionSchema>;

const identifiersSchema = z.strictObject({
  userId: z.uuid(),
  societyId: z.uuid(),
  scheduleId: z.uuid(),
});

const requestSchema = z.strictObject({
  requestKey: z.uuid(),
  action: actionSchema,
  reviewFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

type ScheduleRow = {
  id: string;
  title: string;
  status: "draft" | "active" | "paused" | "ended";
  revision: number;
  firstMonth: string;
  finalMonth: string | null;
  nextMonth: string;
  generationDay: number;
  paymentWindowDays: number;
  targetKind: "unit" | "unit_type";
  targetUnitId: string | null;
  targetUnitTypeId: string | null;
};

const transitions = {
  activate: { from: "draft", to: "active", event: "activated" },
  pause: { from: "active", to: "paused", event: "paused" },
  resume: { from: "paused", to: "active", event: "resumed" },
} as const;

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));

  if (number === 12) {
    if (year >= 9999) {
      throw new InvoiceScheduleError(
        "DATE_LIMIT",
        "This schedule exceeds the supported date range.",
        409,
      );
    }

    return `${String(year + 1).padStart(4, "0")}-01`;
  }

  return `${String(year).padStart(4, "0")}-${String(number + 1).padStart(2, "0")}`;
}

async function readSchedule(
  client: PoolClient,
  societyId: string,
  scheduleId: string,
): Promise<ScheduleRow> {
  const result = await client.query<ScheduleRow>(
    `SELECT
       id, title, status, revision,
       to_char(first_billing_month, 'YYYY-MM') AS "firstMonth",
       to_char(final_billing_month, 'YYYY-MM') AS "finalMonth",
       to_char(next_billing_month, 'YYYY-MM') AS "nextMonth",
       generation_day AS "generationDay",
       payment_window_days AS "paymentWindowDays",
       target_kind AS "targetKind",
       target_unit_id AS "targetUnitId",
       target_unit_type_id AS "targetUnitTypeId"
     FROM invoice_schedules
     WHERE society_id = $1 AND id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [societyId, scheduleId],
  );

  if (!result.rows[0]) {
    throw new InvoiceScheduleError(
      "SCHEDULE_NOT_FOUND",
      "This recurring schedule could not be found.",
      404,
    );
  }

  return result.rows[0];
}

async function buildReview(
  client: PoolClient,
  societyId: string,
  scheduleId: string,
  action: Action,
) {
  const schedule = await readSchedule(client, societyId, scheduleId);
  const transition = transitions[action];

  if (schedule.status !== transition.from) {
    throw new InvoiceScheduleError(
      "INVALID_TRANSITION",
      `This schedule cannot be ${transition.event} from its current status. Refresh the page.`,
      409,
    );
  }

  if (action !== "pause") {
    const society = await client.query<{ status: string }>(
      `SELECT service_status AS status
       FROM societies WHERE id = $1 FOR SHARE`,
      [societyId],
    );

    if (society.rows[0]?.status !== "active") {
      throw new InvoiceScheduleError(
        "SERVICES_INACTIVE",
        "Activate society services before activating or resuming billing.",
        409,
      );
    }
  }

  const clock = await client.query<{ today: string }>(
    `SELECT to_char(
       clock_timestamp() AT TIME ZONE 'Asia/Kolkata',
       'YYYY-MM-DD'
     ) AS today`,
  );

  const today = clock.rows[0].today;
  const day = String(schedule.generationDay).padStart(2, "0");

  let eligibleMonth: string | null = null;
  let firstGenerationDate: string | null = null;

  if (action !== "pause") {
    // Never restart before the schedule's existing next month.
    eligibleMonth = [
      schedule.firstMonth,
      schedule.nextMonth,
      today.slice(0, 7),
    ].sort().at(-1)!;

    if (`${eligibleMonth}-${day}` < today) {
      eligibleMonth = nextMonth(eligibleMonth);
    }

    if (
      schedule.finalMonth !== null &&
      eligibleMonth > schedule.finalMonth
    ) {
      throw new InvoiceScheduleError(
        "SCHEDULE_FINISHED",
        "No future generation dates remain in this schedule. Create a new schedule with a later end date.",
        409,
      );
    }

    firstGenerationDate = `${eligibleMonth}-${day}`;
  }

  const linesResult = await client.query<{
    position: number;
    description: string;
    amountPaise: string;
  }>(
    `SELECT position, description, amount_paise::text AS "amountPaise"
     FROM invoice_schedule_lines
     WHERE schedule_id = $1
     ORDER BY position`,
    [scheduleId],
  );

  const lines = linesResult.rows.map((line) => ({
    ...line,
    amountPaise: Number(line.amountPaise),
  }));

  const totalPaise = lines.reduce(
    (total, line) => total + line.amountPaise,
    0,
  );

  if (
    action !== "pause" &&
    (
      lines.length < 1 ||
      lines.length > 20 ||
      !Number.isSafeInteger(totalPaise) ||
      lines.some(
        (line) =>
          !Number.isSafeInteger(line.amountPaise) ||
          line.amountPaise < 1 ||
          line.amountPaise > 100_000_000,
      )
    )
  ) {
    throw new InvoiceScheduleError(
      "INVALID_LINES",
      "Check the schedule's bill items before activation.",
      409,
    );
  }

  const condition = schedule.targetKind === "unit"
    ? "id = $2"
    : "unit_type_id = $2";

  const targetId = schedule.targetKind === "unit"
    ? schedule.targetUnitId
    : schedule.targetUnitTypeId;

  const recipients = await client.query<{ id: string }>(
    `SELECT id FROM society_units
     WHERE society_id = $1 AND ${condition}
     ORDER BY id`,
    [societyId, targetId],
  );

  if (action !== "pause" && recipients.rows.length === 0) {
    throw new InvoiceScheduleError(
      "NO_RECIPIENTS",
      "No registered flats currently match this schedule.",
      409,
    );
  }

  const combinedAmountPaise = totalPaise * recipients.rows.length;

  if (
    action !== "pause" &&
    !Number.isSafeInteger(combinedAmountPaise)
  ) {
    throw new InvoiceScheduleError(
      "TOTAL_TOO_LARGE",
      "This billing batch exceeds the supported total.",
      409,
    );
  }

  const review = {
    societyId,
    scheduleId,
    action,
    title: schedule.title,
    revision: schedule.revision,
    currentStatus: schedule.status,
    resultingStatus: transition.to,
    targetKind: schedule.targetKind,
    targetId,
    firstGenerationDate,
    nextBillingMonth: eligibleMonth,
    finalBillingMonth: schedule.finalMonth,
    generationDay: schedule.generationDay,
    paymentWindowDays: schedule.paymentWindowDays,
    recipientCount: recipients.rows.length,
    amountPerBillPaise: totalPaise,
    combinedAmountPaise,
    lines,
    recipientIds: recipients.rows.map((row) => row.id),
  };

  const reviewFingerprint = createHash("sha256")
    .update(JSON.stringify(review))
    .digest("hex");

  return { ...review, reviewFingerprint };
}

export async function prepareScheduleControl(
  userId: string,
  societyId: string,
  scheduleId: string,
  requestedAction: unknown,
) {
  identifiersSchema.parse({ userId, societyId, scheduleId });
  const action = actionSchema.parse(requestedAction);

  return withChairmanUnitAccess(userId, societyId, (client) =>
    buildReview(client, societyId, scheduleId, action),
  );
}

export async function controlInvoiceSchedule(
  userId: string,
  societyId: string,
  scheduleId: string,
  input: unknown,
) {
  identifiersSchema.parse({ userId, societyId, scheduleId });
  const request = requestSchema.parse(input);

  return withChairmanUnitAccess(userId, societyId, async (client) => {
    // The society transaction lock serializes actions and their retries.
    const previous = await client.query<{
      sameRequest: boolean;
      result: {
        scheduleId: string;
        status: string;
        firstGenerationDate: string | null;
      };
    }>(
      `SELECT
         snapshot->'request' = $4::jsonb AS "sameRequest",
         snapshot->'result' AS result
       FROM invoice_schedule_events
       WHERE society_id = $1
         AND schedule_id = $2
         AND snapshot->'request'->>'requestKey' = $3
         AND action IN ('activated', 'paused', 'resumed')
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [
        societyId,
        scheduleId,
        request.requestKey,
        JSON.stringify(request),
      ],
    );

    if (previous.rows[0]) {
      if (!previous.rows[0].sameRequest) {
        throw new InvoiceScheduleError(
          "REQUEST_KEY_CONFLICT",
          "This request key was already used for a different action.",
          409,
        );
      }

      return { ...previous.rows[0].result, replayed: true };
    }

    const review = await buildReview(
      client,
      societyId,
      scheduleId,
      request.action,
    );

    if (review.reviewFingerprint !== request.reviewFingerprint) {
      throw new InvoiceScheduleError(
        "REVIEW_CHANGED",
        "The schedule, recipients, or first generation date changed. Review again before confirming.",
        409,
      );
    }

    const transition = transitions[request.action];

    await client.query(
      `UPDATE invoice_schedules
       SET status = $3,
           next_billing_month = COALESCE($4::date, next_billing_month),
           revision = revision + 1,
           updated_at = clock_timestamp()
       WHERE society_id = $1 AND id = $2`,
      [
        societyId,
        scheduleId,
        transition.to,
        review.nextBillingMonth
          ? `${review.nextBillingMonth}-01`
          : null,
      ],
    );

    const result = {
      scheduleId,
      status: transition.to,
      firstGenerationDate: review.firstGenerationDate,
    };

    await client.query(
      `INSERT INTO invoice_schedule_events (
         society_id, schedule_id, actor_user_id, action, snapshot
       )
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        societyId,
        scheduleId,
        userId,
        transition.event,
        JSON.stringify({
          request,
          result,
          previousRevision: review.revision,
          recipientCountAtConfirmation: review.recipientCount,
          amountPerBillPaise: review.amountPerBillPaise,
        }),
      ],
    );

    return { ...result, replayed: false };
  });
}
