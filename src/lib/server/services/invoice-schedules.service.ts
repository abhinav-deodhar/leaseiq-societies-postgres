import "server-only";
import { createInvoiceScheduleRequestSchema } from "@/lib/contracts/invoice-schedules";
import { withChairmanUnitAccess } from "./units.service";

export class InvoiceScheduleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "InvoiceScheduleError";
  }
}

export async function createInvoiceSchedule(
  userId: string,
  societyId: string,
  input: unknown,
) {
  const request = createInvoiceScheduleRequestSchema.parse(input);
  const schedule = request.schedule;

  return withChairmanUnitAccess(userId, societyId, async (client) => {
    const existing = await client.query<{
      id: string;
      status: string;
      sameRequest: boolean;
    }>(
      `SELECT s.id, s.status,
         EXISTS (
           SELECT 1 FROM invoice_schedule_events e
           WHERE e.schedule_id = s.id
             AND e.society_id = s.society_id
             AND e.action = 'created'
             AND e.snapshot->'request' = $3::jsonb
         ) AS "sameRequest"
       FROM invoice_schedules s
       WHERE s.society_id = $1 AND s.request_key = $2`,
      [societyId, request.requestKey, JSON.stringify(schedule)],
    );

    const previous = existing.rows[0];
    if (previous) {
      if (!previous.sameRequest) {
        throw new InvoiceScheduleError(
          "REQUEST_KEY_CONFLICT",
          "This request key was already used for different schedule details.",
          409,
        );
      }
      return {
        scheduleId: previous.id,
        status: previous.status,
        replayed: true,
      };
    }

    const target = schedule.target;
    const targetId = target.kind === "unit"
      ? target.unitId
      : target.unitTypeId;

    const targetResult = target.kind === "unit"
      ? await client.query(
          "SELECT id FROM society_units WHERE society_id = $1 AND id = $2",
          [societyId, targetId],
        )
      : await client.query(
          "SELECT id FROM society_unit_types WHERE society_id = $1 AND id = $2",
          [societyId, targetId],
        );

    if (targetResult.rowCount !== 1) {
      throw new InvoiceScheduleError(
        "INVALID_TARGET",
        "Choose a flat or unit type belonging to this society.",
        400,
      );
    }

    const result = await client.query<{ id: string; status: string }>(
      `INSERT INTO invoice_schedules (
         society_id, created_by, request_key, title,
         target_kind, target_unit_id, target_unit_type_id,
         first_billing_month, final_billing_month,
         generation_day, payment_window_days, next_billing_month
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8::date, $9::date, $10, $11, $8::date
       )
       RETURNING id, status`,
      [
        societyId,
        userId,
        request.requestKey,
        schedule.title,
        target.kind,
        target.kind === "unit" ? target.unitId : null,
        target.kind === "unit_type" ? target.unitTypeId : null,
        `${schedule.firstBillingMonth}-01`,
        schedule.finalBillingMonth
          ? `${schedule.finalBillingMonth}-01`
          : null,
        schedule.generationDay,
        schedule.paymentWindowDays,
      ],
    );

    const created = result.rows[0];

    for (const [index, line] of schedule.lines.entries()) {
      await client.query(
        `INSERT INTO invoice_schedule_lines (
           schedule_id, position, description, amount_paise
         ) VALUES ($1, $2, $3, $4)`,
        [created.id, index + 1, line.description, line.amountPaise],
      );
    }

    await client.query(
      `INSERT INTO invoice_schedule_events (
         society_id, schedule_id, actor_user_id, action, snapshot
       ) VALUES ($1, $2, $3, 'created', $4::jsonb)`,
      [
        societyId,
        created.id,
        userId,
        JSON.stringify({ request: schedule }),
      ],
    );

    return {
      scheduleId: created.id,
      status: created.status,
      replayed: false,
    };
  });
}
