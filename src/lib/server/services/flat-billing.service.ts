import "server-only";
import type { PoolClient } from "pg";
import { withChairmanUnitAccess } from "./units.service";

export type BillingFilter = "all" | "paid" | "outstanding" | "overdue";

export function parseBillingFilter(value: unknown): BillingFilter {
  return value === "paid" || value === "outstanding" || value === "overdue"
    ? value
    : "all";
}

function normalizeBillingFilter(value: boolean | BillingFilter): BillingFilter {
  return typeof value === "boolean" ? (value ? "paid" : "all") : parseBillingFilter(value);
}

export async function listFlatBilling(userId: string, societyId: string, page: number, search: string, paidOnly: boolean | BillingFilter) {
  return withChairmanUnitAccess(userId, societyId, (client) => listFlatBillingInTransaction(client, societyId, page, search, paidOnly));
}

export async function listFlatBillingInTransaction(client: PoolClient, societyId: string, page: number, search: string, paidOnly: boolean | BillingFilter) {
    const filter = normalizeBillingFilter(paidOnly);
    const pageSize = 20;
    const result = await client.query<{
      id: string; wing: string; flatNumber: string; occupancy: string;
      owners: string[]; tenants: string[]; billCount: number; paidCount: number;
      outstandingCount: number; overdueCount: number;
      billedPaise: string; receivedPaise: string; total: number;
    }>(`WITH contacts AS (
      SELECT unit_id,
        array_agg(full_name ORDER BY full_name) FILTER (WHERE role = 'owner') AS owners,
        array_agg(full_name ORDER BY full_name) FILTER (WHERE role = 'tenant') AS tenants
      FROM unit_billing_contacts WHERE society_id = $1
        AND starts_on <= (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
        AND (ends_on IS NULL OR ends_on >= (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date)
      GROUP BY unit_id
    ), receipts AS (
      SELECT invoice_id, SUM(amount_paise) AS received FROM invoice_receipts
      WHERE society_id = $1 AND reversed_at IS NULL GROUP BY invoice_id
    ), bills AS (
      SELECT i.unit_id, COUNT(*)::integer AS count,
        COUNT(*) FILTER (WHERE COALESCE(r.received,0) >= i.total_paise)::integer AS paid,
        COUNT(*) FILTER (
          WHERE COALESCE(r.received,0) < i.total_paise
        )::integer AS outstanding,
        COUNT(*) FILTER (
          WHERE COALESCE(r.received,0) < i.total_paise
            AND i.due_date < (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
        )::integer AS overdue,
        SUM(i.total_paise) AS billed, SUM(COALESCE(r.received,0)) AS received
      FROM society_invoices i LEFT JOIN receipts r ON r.invoice_id = i.id
      WHERE i.society_id = $1 AND i.status = 'issued' GROUP BY i.unit_id
    ) SELECT u.id, u.wing, u.flat_number AS "flatNumber", u.occupancy_status AS occupancy,
       COALESCE(c.owners, ARRAY[]::text[]) AS owners, COALESCE(c.tenants, ARRAY[]::text[]) AS tenants,
       COALESCE(b.count,0)::integer AS "billCount", COALESCE(b.paid,0)::integer AS "paidCount",
       COALESCE(b.outstanding,0)::integer AS "outstandingCount",
       COALESCE(b.overdue,0)::integer AS "overdueCount",
       COALESCE(b.billed,0)::text AS "billedPaise", COALESCE(b.received,0)::text AS "receivedPaise",
       COUNT(*) OVER()::integer AS total
     FROM society_units u LEFT JOIN contacts c ON c.unit_id = u.id LEFT JOIN bills b ON b.unit_id = u.id
     WHERE u.society_id = $1 AND (
       $3::text = 'all'
       OR ($3 = 'paid' AND b.paid > 0)
       OR ($3 = 'outstanding' AND b.outstanding > 0)
       OR ($3 = 'overdue' AND b.overdue > 0)
     )
       AND ($2 = '' OR strpos(lower(concat_ws(' ',u.wing,u.flat_number,array_to_string(c.owners,' '),array_to_string(c.tenants,' '))),lower($2)) > 0)
     ORDER BY lower(u.wing), lower(u.flat_number), u.id LIMIT $4 OFFSET $5`,
    [societyId, search, filter, pageSize, (page-1)*pageSize]);
    return { flats: result.rows, page, pageSize, total: result.rows[0]?.total ?? 0 };
}

export async function getFlatBills(userId: string, societyId: string, unitId: string, page: number, paidOnly: boolean | BillingFilter) {
  return withChairmanUnitAccess(userId, societyId, (client) => getFlatBillsInTransaction(client, societyId, unitId, page, paidOnly));
}

export async function getFlatBillsInTransaction(client: PoolClient, societyId: string, unitId: string, page: number, paidOnly: boolean | BillingFilter) {
    const filter = normalizeBillingFilter(paidOnly);
    const flat = await client.query<{ wing: string; flatNumber: string; occupancy: string }>(
      'SELECT wing, flat_number AS "flatNumber", occupancy_status AS occupancy FROM society_units WHERE society_id=$1 AND id=$2', [societyId,unitId]);
    if (!flat.rows[0]) return null;
    const contacts = await client.query<{ fullName: string; role: string }>(`SELECT full_name AS "fullName", role FROM unit_billing_contacts
      WHERE society_id=$1 AND unit_id=$2 AND starts_on <= (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
      AND (ends_on IS NULL OR ends_on >= (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date) ORDER BY role,full_name`,[societyId,unitId]);
    const bills = await client.query<{ id: string; number: string; title: string; dueDate: string; totalPaise: string; receivedPaise: string; outstandingPaise: string; isOverdue: boolean; status: string; total: number }>(`
      WITH amounts AS (
        SELECT i.id, i.invoice_number::text AS number,i.title,to_char(i.due_date,'DD Mon YYYY') AS "dueDate",
          i.total_paise::text AS "totalPaise",COALESCE(SUM(r.amount_paise),0)::text AS "receivedPaise",
          CASE WHEN i.status = 'void' THEN '0'
            ELSE (i.total_paise - COALESCE(SUM(r.amount_paise),0))::text
          END AS "outstandingPaise",
          (
            i.status = 'issued'
            AND COALESCE(SUM(r.amount_paise),0) < i.total_paise
            AND i.due_date < (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
          ) AS "isOverdue",
          CASE WHEN i.status='void' THEN 'Voided'
            WHEN COALESCE(SUM(r.amount_paise),0)>=i.total_paise THEN 'Paid'
            WHEN COALESCE(SUM(r.amount_paise),0)>0 THEN 'Part-paid'
            WHEN i.due_date < (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date THEN 'Overdue'
            ELSE 'Unpaid' END AS status, i.issued_at
        FROM society_invoices i LEFT JOIN invoice_receipts r ON r.invoice_id=i.id AND r.society_id=i.society_id AND r.reversed_at IS NULL
        WHERE i.society_id=$1 AND i.unit_id=$2 GROUP BY i.id
      ) SELECT *,COUNT(*) OVER()::integer AS total FROM amounts
      WHERE $3::text = 'all'
         OR ($3 = 'paid' AND status = 'Paid')
         OR ($3 = 'outstanding' AND "outstandingPaise"::numeric > 0)
         OR ($3 = 'overdue' AND "isOverdue")
      ORDER BY issued_at DESC,id DESC LIMIT 20 OFFSET $4`,[societyId,unitId,filter,(page-1)*20]);
    return { flat: flat.rows[0], contacts: contacts.rows, bills: bills.rows, total: bills.rows[0]?.total ?? 0 };
}
