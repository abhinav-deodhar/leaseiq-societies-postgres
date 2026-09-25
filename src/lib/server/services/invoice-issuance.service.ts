import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { withChairmanUnitAccess } from "./units.service";
import { InvoiceDraftError } from "./invoice-drafts.service";

const identifiersSchema = z.strictObject({
  userId: z.uuid(),
  societyId: z.uuid(),
  draftId: z.uuid(),
});

const issueSchema = z.strictObject({
  reviewFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

type DraftRow = {
  id: string;
  title: string;
  billingMonth: string;
  dueDate: string;
  status: "draft" | "issued" | "cancelled";
  revision: number;
  targetKind: "unit" | "unit_type";
  targetUnitId: string | null;
  targetUnitTypeId: string | null;
};

type SocietySnapshot = {
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pinCode: string;
};

type UnitSnapshot = {
  id: string;
  wing: string;
  flatNumber: string;
  floorLabel: string | null;
  unitTypeName: string | null;
  occupancyStatus: string;
  owners: string[];
  tenants: string[];
};

type InvoiceLine = {
  position: number;
  description: string;
  amountPaise: number;
};

async function readDraft(
  client: PoolClient,
  societyId: string,
  draftId: string,
): Promise<DraftRow> {
  const result = await client.query<DraftRow>(
    `SELECT
       id,
       title,
       to_char(billing_month, 'YYYY-MM-DD') AS "billingMonth",
       to_char(due_date, 'YYYY-MM-DD') AS "dueDate",
       status,
       revision,
       target_kind AS "targetKind",
       target_unit_id AS "targetUnitId",
       target_unit_type_id AS "targetUnitTypeId"
     FROM invoice_drafts
     WHERE society_id = $1 AND id = $2
     FOR UPDATE`,
    [societyId, draftId],
  );

  const draft = result.rows[0];

  if (!draft) {
    throw new InvoiceDraftError(
      "DRAFT_NOT_FOUND",
      "This invoice draft could not be found.",
      404,
    );
  }

  return draft;
}

async function requireActiveSociety(
  client: PoolClient,
  societyId: string,
): Promise<SocietySnapshot> {
  const result = await client.query<
    SocietySnapshot & { serviceStatus: string }
  >(
    `SELECT
       name,
       address_line_1 AS "addressLine1",
       address_line_2 AS "addressLine2",
       city,
       state_or_union_territory AS state,
       pin_code AS "pinCode",
       service_status AS "serviceStatus"
     FROM societies
     WHERE id = $1
     FOR SHARE`,
    [societyId],
  );

  const society = result.rows[0];

  if (!society || society.serviceStatus !== "active") {
    throw new InvoiceDraftError(
      "SERVICES_INACTIVE",
      "Activate society services before issuing bills.",
      409,
    );
  }

  return {
    name: society.name,
    addressLine1: society.addressLine1,
    addressLine2: society.addressLine2,
    city: society.city,
    state: society.state,
    pinCode: society.pinCode,
  };
}

async function buildReview(
  client: PoolClient,
  societyId: string,
  draft: DraftRow,
  society: SocietySnapshot,
) {
  if (draft.status !== "draft") {
    throw new InvoiceDraftError(
      "DRAFT_NOT_EDITABLE",
      "Only an unissued draft can be reviewed for issuance.",
      409,
    );
  }

  const lineResult = await client.query<{
    position: number;
    description: string;
    amountPaise: string;
  }>(
    `SELECT
       position,
       description,
       amount_paise AS "amountPaise"
     FROM invoice_draft_lines
     WHERE draft_id = $1
     ORDER BY position`,
    [draft.id],
  );

  const lines: InvoiceLine[] = lineResult.rows.map((line) => ({
    ...line,
    amountPaise: Number(line.amountPaise),
  }));

  if (
    lines.length < 1 ||
    lines.length > 20 ||
    lines.some(
      (line) =>
        !Number.isSafeInteger(line.amountPaise) ||
        line.amountPaise < 1 ||
        line.amountPaise > 100_000_000,
    )
  ) {
    throw new InvoiceDraftError(
      "INVALID_LINES",
      "Check the bill items before issuing this draft.",
      409,
    );
  }

  const totalPaise = lines.reduce(
    (total, line) => total + line.amountPaise,
    0,
  );

  const condition = draft.targetKind === "unit"
    ? "u.id = $2"
    : "u.unit_type_id = $2";

  const targetId = draft.targetKind === "unit"
    ? draft.targetUnitId
    : draft.targetUnitTypeId;

  const units = await client.query<UnitSnapshot>(
    `SELECT
       u.id,
       u.wing,
       u.flat_number AS "flatNumber",
       u.floor_label AS "floorLabel",
       t.name AS "unitTypeName",
       u.occupancy_status AS "occupancyStatus",
       COALESCE(
         (
           SELECT array_agg(c.full_name ORDER BY c.full_name, c.id)
           FROM unit_billing_contacts c
           WHERE c.society_id = u.society_id
             AND c.unit_id = u.id
             AND c.role = 'owner'
             AND c.starts_on <=
               (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
             AND (
               c.ends_on IS NULL OR c.ends_on >=
                 (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
             )
         ),
         ARRAY[]::text[]
       ) AS owners,
       COALESCE(
         (
           SELECT array_agg(c.full_name ORDER BY c.full_name, c.id)
           FROM unit_billing_contacts c
           WHERE c.society_id = u.society_id
             AND c.unit_id = u.id
             AND c.role = 'tenant'
             AND c.starts_on <=
               (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
             AND (
               c.ends_on IS NULL OR c.ends_on >=
                 (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
             )
         ),
         ARRAY[]::text[]
       ) AS tenants
     FROM society_units u
     LEFT JOIN society_unit_types t
       ON t.id = u.unit_type_id
      AND t.society_id = u.society_id
     WHERE u.society_id = $1 AND ${condition}
     ORDER BY u.id`,
    [societyId, targetId],
  );

  if (units.rows.length === 0) {
    throw new InvoiceDraftError(
      "NO_RECIPIENTS",
      "No registered flats currently match this draft.",
      409,
    );
  }

  const combinedAmountPaise = totalPaise * units.rows.length;

  if (!Number.isSafeInteger(combinedAmountPaise)) {
    throw new InvoiceDraftError(
      "TOTAL_TOO_LARGE",
      "This billing batch exceeds the supported total.",
      409,
    );
  }

  const snapshot = {
    societyId,
    draftId: draft.id,
    revision: draft.revision,
    title: draft.title,
    billingMonth: draft.billingMonth,
    dueDate: draft.dueDate,
    targetKind: draft.targetKind,
    targetId,
    society,
    lines,
    totalPaise,
    recipients: units.rows,
  };

  const reviewFingerprint = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");

  return {
    snapshot,
    reviewFingerprint,
    recipientCount: units.rows.length,
    totalPaise,
    combinedAmountPaise,
  };
}

export async function prepareInvoiceIssue(
  userId: string,
  societyId: string,
  draftId: string,
) {
  identifiersSchema.parse({ userId, societyId, draftId });

  return withChairmanUnitAccess(userId, societyId, (client) =>
    prepareInvoiceIssueInTransaction(client, societyId, draftId),
  );
}

/**
 * Internal service helper.
 * Caller must already hold the society-management lock and have
 * checked chairman access inside this transaction.
 * This helper neither starts nor commits a transaction.
 */
export async function prepareInvoiceIssueInTransaction(
  client: PoolClient,
  societyId: string,
  draftId: string,
) {
  const draft = await readDraft(client, societyId, draftId);
  const society = await requireActiveSociety(client, societyId);
  const review = await buildReview(client, societyId, draft, society);

  return {
    draftId,
    title: draft.title,
    dueDate: draft.dueDate,
    reviewFingerprint: review.reviewFingerprint,
    recipientCount: review.recipientCount,
    amountPerBillPaise: review.totalPaise,
    combinedAmountPaise: review.combinedAmountPaise,
    recipients: review.snapshot.recipients,
    lines: review.snapshot.lines,
  };
}

export async function issueInvoiceDraft(
  userId: string,
  societyId: string,
  draftId: string,
  input: unknown,
) {
  identifiersSchema.parse({ userId, societyId, draftId });
  const request = issueSchema.parse(input);

  return withChairmanUnitAccess(userId, societyId, (client) =>
    issueInvoiceDraftInTransaction(
      client, userId, societyId, draftId, request,
    ),
  );
}

/**
 * Internal service helper.
 * Caller must already hold the society-management lock and have
 * checked chairman access inside this transaction.
 * Bills, numbering, audit records and notification records remain
 * part of the caller's transaction.
 */
export async function issueInvoiceDraftInTransaction(
  client: PoolClient,
  userId: string,
  societyId: string,
  draftId: string,
  input: unknown,
) {
  identifiersSchema.parse({ userId, societyId, draftId });
  const request = issueSchema.parse(input);

  const draft = await readDraft(client, societyId, draftId);

  // A retry after a successful commit returns the existing result.
  // A draft can be issued only once.
  if (draft.status === "issued") {
    const existing = await client.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count
       FROM society_invoices
       WHERE society_id = $1 AND draft_id = $2`,
      [societyId, draftId],
    );

    return {
      draftId,
      status: "issued" as const,
      invoiceCount: existing.rows[0].count,
      replayed: true,
    };
  }

  const society = await requireActiveSociety(client, societyId);
  const review = await buildReview(client, societyId, draft, society);

  if (review.reviewFingerprint !== request.reviewFingerprint) {
    throw new InvoiceDraftError(
      "REVIEW_CHANGED",
      "The bill or its recipients have changed. Review the updated details before issuing.",
      409,
    );
  }

  await client.query(
    `INSERT INTO society_invoice_counters (society_id, last_number)
     VALUES ($1, 0)
     ON CONFLICT (society_id) DO NOTHING`,
    [societyId],
  );

  const counter = await client.query<{ firstNumber: string }>(
    `UPDATE society_invoice_counters
     SET last_number = last_number + $2::bigint
     WHERE society_id = $1
       AND last_number <= 9007199254740991 - $2::bigint
     RETURNING
       (last_number - $2::bigint + 1)::text AS "firstNumber"`,
    [societyId, review.recipientCount],
  );

  if (!counter.rows[0]) {
    throw new InvoiceDraftError(
      "NUMBER_LIMIT_REACHED",
      "The society invoice-number limit has been reached.",
      409,
    );
  }

  const firstNumber = BigInt(counter.rows[0].firstNumber);

  for (const [index, unit] of review.snapshot.recipients.entries()) {
    const invoiceNumber = (firstNumber + BigInt(index)).toString();

    const created = await client.query<{ id: string }>(
      `INSERT INTO society_invoices (
         society_id, draft_id, unit_id, invoice_number,
         title, billing_month, due_date, total_paise,
         society_snapshot, unit_snapshot, lines_snapshot,
         issued_by
       )
       VALUES (
         $1, $2, $3, $4::bigint,
         $5, $6::date, $7::date, $8,
         $9::jsonb, $10::jsonb, $11::jsonb, $12
       )
       RETURNING id`,
      [
        societyId,
        draftId,
        unit.id,
        invoiceNumber,
        draft.title,
        draft.billingMonth,
        draft.dueDate,
        review.totalPaise,
        JSON.stringify(review.snapshot.society),
        JSON.stringify(unit),
        JSON.stringify(review.snapshot.lines),
        userId,
      ],
    );

    const invoiceId = created.rows[0].id;

    await client.query(
      `INSERT INTO invoice_events (
         society_id, draft_id, invoice_id,
         actor_user_id, action, snapshot
       )
       VALUES ($1, $2, $3, $4, 'invoice_issued', $5::jsonb)`,
      [
        societyId,
        draftId,
        invoiceId,
        userId,
        JSON.stringify({
          invoiceNumber,
          unitId: unit.id,
          totalPaise: review.totalPaise,
          reviewFingerprint: review.reviewFingerprint,
        }),
      ],
    );

    await client.query(
      `INSERT INTO invoice_notification_outbox (
         society_id, invoice_id
       )
       VALUES ($1, $2)`,
      [societyId, invoiceId],
    );
  }

  await client.query(
    `UPDATE invoice_drafts
     SET status = 'issued',
         issued_at = clock_timestamp(),
         issued_by = $3,
         updated_at = clock_timestamp(),
         revision = revision + 1
     WHERE society_id = $1 AND id = $2`,
    [societyId, draftId, userId],
  );

  return {
    draftId,
    status: "issued" as const,
    invoiceCount: review.recipientCount,
    replayed: false,
  };
}
