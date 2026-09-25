import "server-only";
import type { PoolClient } from "pg";
import { withChairmanUnitAccess } from "./units.service";
import { InvoiceDraftError } from "./invoice-drafts.service";

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
  createdAt: string;
  totalPaise: number;
};

const draftColumns = `
  d.id,
  d.title,
  to_char(d.billing_month, 'YYYY-MM') AS "billingMonth",
  to_char(d.due_date, 'YYYY-MM-DD') AS "dueDate",
  d.status,
  d.revision,
  d.target_kind AS "targetKind",
  d.target_unit_id AS "targetUnitId",
  d.target_unit_type_id AS "targetUnitTypeId",
  d.created_at::text AS "createdAt",
  COALESCE(
    (SELECT SUM(l.amount_paise)
     FROM invoice_draft_lines l WHERE l.draft_id = d.id),
    0
  )::bigint AS "totalPaise"
`;

function serializeDraft(row: DraftRow) {
  const totalPaise = Number(row.totalPaise);
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 1) {
    throw new Error("Invalid invoice draft total.");
  }
  return {
    ...row,
    totalPaise,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function listInvoiceDrafts(
  userId: string,
  societyId: string,
  page: number,
) {
  return withChairmanUnitAccess(userId, societyId, async (client) => {
    const pageSize = 20;

    const count = await client.query<{ total: number }>(
      "SELECT COUNT(*)::integer AS total FROM invoice_drafts WHERE society_id = $1 AND status = 'draft'",
      [societyId],
    );

    const result = await client.query<DraftRow>(
      `SELECT ${draftColumns}
       FROM invoice_drafts d
       WHERE d.society_id = $1 AND d.status = 'draft'
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT $2 OFFSET $3`,
      [societyId, pageSize, (page - 1) * pageSize],
    );

    return {
      drafts: result.rows.map(serializeDraft),
      page,
      pageSize,
      total: count.rows[0].total,
    };
  });
}

async function readRecipients(
  client: PoolClient,
  societyId: string,
  draft: DraftRow,
) {
  const condition = draft.targetKind === "unit"
    ? "u.id = $2"
    : "u.unit_type_id = $2";
  const targetId = draft.targetKind === "unit"
    ? draft.targetUnitId
    : draft.targetUnitTypeId;

  const count = await client.query<{ count: number }>(
    `SELECT COUNT(*)::integer AS count
     FROM society_units u
     WHERE u.society_id = $1 AND ${condition}`,
    [societyId, targetId],
  );

  const result = await client.query<{
    id: string;
    wing: string;
    flatNumber: string;
    unitTypeName: string | null;
  }>(
    `SELECT u.id, u.wing,
       u.flat_number AS "flatNumber",
       t.name AS "unitTypeName"
     FROM society_units u
     LEFT JOIN society_unit_types t
       ON t.id = u.unit_type_id AND t.society_id = u.society_id
     WHERE u.society_id = $1 AND ${condition}
     ORDER BY lower(u.wing), lower(u.flat_number), u.id
     LIMIT 50`,
    [societyId, targetId],
  );

  const recipientCount = count.rows[0].count;
  return {
    recipientCount,
    recipients: result.rows,
    previewLimit: 50,
    hasMoreRecipients: recipientCount > result.rows.length,
    amountPerFlatPaise: Number(draft.totalPaise),
    combinedAmountPaise: recipientCount * Number(draft.totalPaise),
  };
}

export async function getInvoiceDraft(
  userId: string,
  societyId: string,
  draftId: string,
) {
  return withChairmanUnitAccess(userId, societyId, async (client) => {
    const result = await client.query<DraftRow>(
      `SELECT ${draftColumns}
       FROM invoice_drafts d
       WHERE d.society_id = $1 AND d.id = $2`,
      [societyId, draftId],
    );

    if (!result.rows[0]) {
      throw new InvoiceDraftError(
        "DRAFT_NOT_FOUND",
        "This invoice draft could not be found.",
        404,
      );
    }

    const draft = serializeDraft(result.rows[0]);
    const lines = await client.query<{
      position: number;
      description: string;
      amountPaise: string;
    }>(
      `SELECT position, description, amount_paise AS "amountPaise"
       FROM invoice_draft_lines
       WHERE draft_id = $1
       ORDER BY position`,
      [draftId],
    );

    return {
      draft: {
        ...draft,
        lines: lines.rows.map((line) => ({
          ...line,
          amountPaise: Number(line.amountPaise),
        })),
      },
      preview: draft.status === "draft"
        ? await readRecipients(client, societyId, draft)
        : null,
    };
  });
}
