import "server-only";
import { withChairmanUnitAccess } from "./units.service";
import { InvoiceScheduleError } from "./invoice-schedules.service";

type ScheduleRow = {
  id: string;
  title: string;
  status: "draft" | "active" | "paused" | "ended";
  revision: number;
  targetKind: "unit" | "unit_type";
  targetUnitId: string | null;
  targetUnitTypeId: string | null;
  firstBillingMonth: string;
  finalBillingMonth: string | null;
  nextBillingMonth: string;
  generationDay: number;
  paymentWindowDays: number;
  totalPaise: string;
};

const columns = `
  s.id, s.title, s.status, s.revision,
  s.target_kind AS "targetKind",
  s.target_unit_id AS "targetUnitId",
  s.target_unit_type_id AS "targetUnitTypeId",
  to_char(s.first_billing_month, 'YYYY-MM') AS "firstBillingMonth",
  to_char(s.final_billing_month, 'YYYY-MM') AS "finalBillingMonth",
  to_char(s.next_billing_month, 'YYYY-MM') AS "nextBillingMonth",
  s.generation_day AS "generationDay",
  s.payment_window_days AS "paymentWindowDays",
  COALESCE(
    (SELECT SUM(l.amount_paise) FROM invoice_schedule_lines l
     WHERE l.schedule_id = s.id), 0
  )::bigint AS "totalPaise"
`;

function serialize(row: ScheduleRow) {
  const totalPaise = Number(row.totalPaise);
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 1) {
    throw new Error("Invalid schedule total.");
  }
  return {
    ...row,
    totalPaise,
    frequency: "monthly" as const,
    timezone: "Asia/Kolkata",
  };
}

export async function listInvoiceSchedules(
  userId: string,
  societyId: string,
  page: number,
) {
  return withChairmanUnitAccess(userId, societyId, async (client) => {
    const pageSize = 20;
    const count = await client.query<{ total: number }>(
      "SELECT COUNT(*)::integer AS total FROM invoice_schedules WHERE society_id = $1 AND deleted_at IS NULL",
      [societyId],
    );
    const result = await client.query<ScheduleRow>(
      `SELECT ${columns}
       FROM invoice_schedules s
       WHERE s.deleted_at IS NULL AND s.society_id = $1
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT $2 OFFSET $3`,
      [societyId, pageSize, (page - 1) * pageSize],
    );
    return {
      schedules: result.rows.map(serialize),
      page,
      pageSize,
      total: count.rows[0].total,
    };
  });
}

export async function getInvoiceSchedule(
  userId: string,
  societyId: string,
  scheduleId: string,
  requestedHistoryPage = 1,
) {
  if (
    !Number.isSafeInteger(requestedHistoryPage) ||
    requestedHistoryPage < 1 ||
    requestedHistoryPage > 999999
  ) {
    throw new InvoiceScheduleError(
      "INVALID_PAGE",
      "Choose a valid history page.",
      400,
    );
  }

  return withChairmanUnitAccess(userId, societyId, async (client) => {
    const result = await client.query<ScheduleRow>(
      `SELECT ${columns}
       FROM invoice_schedules s
       WHERE s.deleted_at IS NULL AND s.society_id = $1 AND s.id = $2`,
      [societyId, scheduleId],
    );
    if (!result.rows[0]) {
      throw new InvoiceScheduleError(
        "SCHEDULE_NOT_FOUND",
        "This recurring schedule could not be found.",
        404,
      );
    }

    const schedule = serialize(result.rows[0]);
    const lines = await client.query<{
      position: number;
      description: string;
      amountPaise: string;
    }>(
      `SELECT position, description, amount_paise AS "amountPaise"
       FROM invoice_schedule_lines WHERE schedule_id = $1
       ORDER BY position`,
      [scheduleId],
    );

    const condition = schedule.targetKind === "unit"
      ? "u.id = $2"
      : "u.unit_type_id = $2";
    const targetId = schedule.targetKind === "unit"
      ? schedule.targetUnitId
      : schedule.targetUnitTypeId;

    const recipients = await client.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM society_units u
       WHERE u.society_id = $1 AND ${condition}`,
      [societyId, targetId],
    );


    const historyPageSize = 20;

    const historyCount = await client.query<{ total: number }>(
      `SELECT COUNT(*)::integer AS total
       FROM invoice_schedule_runs
       WHERE society_id = $1 AND schedule_id = $2`,
      [societyId, scheduleId],
    );

    const historyTotal = historyCount.rows[0].total;
    const historyTotalPages = Math.max(
      1, Math.ceil(historyTotal / historyPageSize),
    );
    const historyPage = Math.min(
      requestedHistoryPage, historyTotalPages,
    );

    const historyRows = await client.query<{
      id: string;
      billingMonth: string;
      scheduledDate: string;
      dueDate: string;
      status: "generated" | "skipped";
      skipReason: string | null;
      recipientCount: number;
      issuedValuePaise: string;
      processedAt: string;
    }>(
      `SELECT
         r.id,
         to_char(r.billing_month, 'YYYY-MM') AS "billingMonth",
         to_char(r.scheduled_date, 'YYYY-MM-DD') AS "scheduledDate",
         to_char(r.due_date, 'YYYY-MM-DD') AS "dueDate",
         r.status,
         r.skip_reason AS "skipReason",
         r.recipient_count AS "recipientCount",
         COALESCE(
           (
             SELECT SUM(i.total_paise)
             FROM society_invoices i
             WHERE i.society_id = r.society_id
               AND i.schedule_run_id = r.id
           ),
           0
         )::text AS "issuedValuePaise",
         r.created_at::text AS "processedAt"
       FROM invoice_schedule_runs r
       WHERE r.society_id = $1 AND r.schedule_id = $2
       ORDER BY r.billing_month DESC, r.id DESC
       LIMIT $3 OFFSET $4`,
      [
        societyId,
        scheduleId,
        historyPageSize,
        (historyPage - 1) * historyPageSize,
      ],
    );

    const history = {
      page: historyPage,
      pageSize: historyPageSize,
      total: historyTotal,
      totalPages: historyTotalPages,
      runs: historyRows.rows.map((row) => {
        const issuedValuePaise = Number(row.issuedValuePaise);

        if (
          !Number.isSafeInteger(issuedValuePaise) ||
          issuedValuePaise < 0
        ) {
          throw new Error("Invalid historical invoice total.");
        }

        return {
          ...row,
          issuedValuePaise,
          processedAt: new Date(row.processedAt).toISOString(),
        };
      }),
    };

    return {
      history,
      schedule: {
        ...schedule,
        lines: lines.rows.map((line) => ({
          ...line,
          amountPaise: Number(line.amountPaise),
        })),
      },
      preview: {
        recipientCount: recipients.rows[0].count,
        amountPerBillPaise: schedule.totalPaise,
        combinedAmountPaise: recipients.rows[0].count * schedule.totalPaise,
      },
    };
  });
}
