import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import { calculateBillPayment } from "@/lib/contracts/bill-payment";
import { withChairmanUnitAccess } from "./units.service";

const optionalText = z.string().nullable().optional();

const societySnapshotSchema = z.object({
  name: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  pinCode: optionalText,
});

const unitSnapshotSchema = z.object({
  wing: optionalText,
  flatNumber: optionalText,
  floorLabel: optionalText,
  unitTypeName: optionalText,
  occupancyStatus: optionalText,
  owners: z.array(z.string()).optional(),
  tenants: z.array(z.string()).optional(),
});

const lineSchema = z.object({
  description: z.string().min(1),
  amountPaise: z.number().int().min(1).max(100_000_000),
});

type Receipt = {
  id: string;
  amountPaise: string;
  source: string;
  reference: string;
  paidAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
};

type BillRow = {
  id: string;
  unitId: string;
  number: string;
  title: string;
  billingMonth: string;
  dueDate: string;
  currency: string;
  totalPaise: string;
  receivedPaise: string;
  status: "issued" | "void";
  issuedAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
  today: string;
  societySnapshot: unknown;
  unitSnapshot: unknown;
  linesSnapshot: unknown;
  receipts: Receipt[];
  receiptCount: number;
};

export async function getIssuedBillDetail(
  userId: string,
  societyId: string,
  invoiceId: string,
  receiptPage = 1,
) {
  z.uuid().parse(userId);
  z.uuid().parse(societyId);
  z.uuid().parse(invoiceId);
  z.number().int().min(1).max(999999).parse(receiptPage);

  return withChairmanUnitAccess(userId, societyId, client =>
    getIssuedBillDetailInTransaction(client, societyId, invoiceId, receiptPage),
  );
}

export async function getIssuedBillDetailInTransaction(
  client: PoolClient,
  societyId: string,
  invoiceId: string,
  receiptPage = 1,
) {
  z.number().int().min(1).max(999999).parse(receiptPage);
  const pageSize = 20;

  // A single statement keeps the balance and receipt history on the same
  // database snapshot, even when a receipt is recorded concurrently.
  const result = await client.query<BillRow>(
    `SELECT
       i.id, i.unit_id AS "unitId",
       i.invoice_number::text AS number,
       i.title,
       to_char(i.billing_month, 'YYYY-MM') AS "billingMonth",
       to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate",
       i.currency,
       i.total_paise::text AS "totalPaise",
       i.status,
       i.issued_at AS "issuedAt",
       i.voided_at AS "voidedAt",
       i.void_reason AS "voidReason",
       to_char(
         statement_timestamp() AT TIME ZONE 'Asia/Kolkata',
         'YYYY-MM-DD'
       ) AS today,
       i.society_snapshot AS "societySnapshot",
       i.unit_snapshot AS "unitSnapshot",
       i.lines_snapshot AS "linesSnapshot",
       (
         SELECT COALESCE(SUM(r.amount_paise), 0)::text
         FROM invoice_receipts r
         WHERE r.society_id = i.society_id
           AND r.invoice_id = i.id AND r.reversed_at IS NULL
       ) AS "receivedPaise",
       (
         SELECT COUNT(*)::integer
         FROM invoice_receipts r
         WHERE r.society_id = i.society_id AND r.invoice_id = i.id
       ) AS "receiptCount",
       COALESCE((
         SELECT jsonb_agg(to_jsonb(receipt) ORDER BY receipt."paidAt" DESC, receipt.id DESC)
         FROM (
           SELECT r.id,
             r.amount_paise::text AS "amountPaise",
             r.source, r.reference,
             to_char(r.paid_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "paidAt",
             to_char(r.reversed_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "reversedAt",
             r.reversal_reason AS "reversalReason"
           FROM invoice_receipts r
           WHERE r.society_id = i.society_id AND r.invoice_id = i.id
           ORDER BY r.paid_at DESC, r.id DESC
           LIMIT $3 OFFSET $4
         ) receipt
       ), '[]'::jsonb) AS receipts
     FROM society_invoices i
     WHERE i.society_id = $1 AND i.id = $2`,
    [societyId, invoiceId, pageSize, (receiptPage - 1) * pageSize],
  );

  const row = result.rows[0];
  if (!row) return null;

  const society = societySnapshotSchema.parse(row.societySnapshot);
  const unit = unitSnapshotSchema.parse(row.unitSnapshot);
  const lines = z.array(lineSchema).min(1).max(20).parse(row.linesSnapshot);

  if (
    BigInt(lines.reduce((sum, line) => sum + line.amountPaise, 0)) !==
    BigInt(row.totalPaise)
  ) {
    throw new Error("Invoice snapshot total is inconsistent.");
  }

  const payment = calculateBillPayment({
    totalPaise: row.totalPaise,
    receivedPaise: row.receivedPaise,
    invoiceStatus: row.status,
    dueDate: row.dueDate,
    today: row.today,
  });

  return {
    invoice: {
      id: row.id,
      societyId,
      unitId: row.unitId,
      number: row.number,
      title: row.title,
      billingMonth: row.billingMonth,
      dueDate: row.dueDate,
      currency: row.currency,
      status: row.status,
      issuedAt: row.issuedAt.toISOString(),
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidReason: row.voidReason,
      society: {
        name: society.name ?? null,
        address: [
          society.addressLine1, society.addressLine2,
          society.city, society.state, society.pinCode,
        ].filter(Boolean).join(", "),
      },
      recipient: {
        wing: unit.wing ?? null,
        flatNumber: unit.flatNumber ?? null,
        floorLabel: unit.floorLabel ?? null,
        unitTypeName: unit.unitTypeName ?? null,
        occupancyStatus: unit.occupancyStatus ?? null,
        owners: unit.owners ?? [],
        tenants: unit.tenants ?? [],
      },
      lines: lines.map(line => ({
        description: line.description,
        amountPaise: String(line.amountPaise),
      })),
      totalPaise: row.totalPaise,
      receivedPaise: row.receivedPaise,
      ...payment,
      asOfDate: row.today,
    },
    receipts: {
      items: row.receipts,
      page: receiptPage,
      pageSize,
      total: row.receiptCount,
    },
  };
}
