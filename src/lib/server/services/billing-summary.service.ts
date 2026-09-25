import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import { withChairmanUnitAccess } from "./units.service";

type SummaryRow = {
  asOfDate: string;
  paidCount: number;
  paidPaise: string;
  outstandingCount: number;
  outstandingPaise: string;
  overdueCount: number;
  overduePaise: string;
  flatsOwingCount: number;
};

export async function getBillingSummary(
  userId: string,
  societyId: string,
) {
  z.uuid().parse(userId);
  z.uuid().parse(societyId);
  return withChairmanUnitAccess(userId, societyId, (client) =>
    getBillingSummaryInTransaction(client, societyId),
  );
}

export async function getBillingSummaryInTransaction(
  client: PoolClient,
  societyId: string,
) {
  const result = await client.query<SummaryRow>(
    `WITH clock AS (
       SELECT (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AS today
     ), receipts AS (
       SELECT invoice_id, SUM(amount_paise) AS received
       FROM invoice_receipts
       WHERE society_id = $1 AND reversed_at IS NULL
       GROUP BY invoice_id
     ), balances AS (
       SELECT
         i.unit_id,
         i.due_date,
         i.total_paise,
         i.total_paise - COALESCE(r.received, 0) AS remaining
       FROM society_invoices i
       LEFT JOIN receipts r ON r.invoice_id = i.id
       WHERE i.society_id = $1 AND i.status = 'issued'
     )
     SELECT
       to_char(clock.today, 'YYYY-MM-DD') AS "asOfDate",
       COUNT(*) FILTER (WHERE b.remaining = 0)::integer AS "paidCount",
       COALESCE(SUM(b.total_paise) FILTER (
         WHERE b.remaining = 0
       ), 0)::text AS "paidPaise",
       COUNT(*) FILTER (WHERE b.remaining > 0)::integer AS "outstandingCount",
       COALESCE(SUM(b.remaining) FILTER (
         WHERE b.remaining > 0
       ), 0)::text AS "outstandingPaise",
       COUNT(*) FILTER (
         WHERE b.remaining > 0 AND b.due_date < clock.today
       )::integer AS "overdueCount",
       COALESCE(SUM(b.remaining) FILTER (
         WHERE b.remaining > 0 AND b.due_date < clock.today
       ), 0)::text AS "overduePaise",
       COUNT(DISTINCT b.unit_id) FILTER (
         WHERE b.remaining > 0
       )::integer AS "flatsOwingCount"
     FROM clock
     LEFT JOIN balances b ON true
     GROUP BY clock.today`,
    [societyId],
  );

  const row = result.rows[0];
  return {
    societyId,
    asOfDate: row.asOfDate,
    currency: "INR" as const,
    paid: {
      billCount: row.paidCount,
      amountPaise: row.paidPaise,
    },
    outstanding: {
      billCount: row.outstandingCount,
      amountPaise: row.outstandingPaise,
    },
    overdue: {
      billCount: row.overdueCount,
      amountPaise: row.overduePaise,
    },
    flatsOwingCount: row.flatsOwingCount,
  };
}
