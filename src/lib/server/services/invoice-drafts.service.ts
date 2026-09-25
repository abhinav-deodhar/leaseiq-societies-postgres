import "server-only";
import { z } from "zod";
import type { PoolClient } from "pg";
import {
  invoiceDraftSchema,
  type InvoiceDraftData,
} from "@/lib/contracts/invoices";
import { withChairmanUnitAccess } from "./units.service";

export const createInvoiceDraftRequestSchema = z.strictObject({
  requestKey: z.uuid(),
  draft: invoiceDraftSchema,
});

export class InvoiceDraftError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "InvoiceDraftError";
  }
}

async function previewRecipients(
  client: PoolClient,
  societyId: string,
  draft: InvoiceDraftData,
) {
  const target = draft.target;
  const targetId = target.kind === "unit"
    ? target.unitId
    : target.unitTypeId;

  const targetExists = target.kind === "unit"
    ? await client.query(
        "SELECT id FROM society_units WHERE society_id = $1 AND id = $2",
        [societyId, targetId],
      )
    : await client.query(
        "SELECT id FROM society_unit_types WHERE society_id = $1 AND id = $2",
        [societyId, targetId],
      );

  if (targetExists.rowCount !== 1) {
    throw new InvoiceDraftError(
      "INVALID_TARGET",
      "Choose a flat or unit type belonging to this society.",
      400,
    );
  }

  const condition = target.kind === "unit"
    ? "u.id = $2"
    : "u.unit_type_id = $2";

  const count = await client.query<{ count: number }>(
    `SELECT COUNT(*)::integer AS count
     FROM society_units u
     WHERE u.society_id = $1 AND ${condition}`,
    [societyId, targetId],
  );

  const recipients = await client.query<{
    id: string;
    wing: string;
    flatNumber: string;
    unitTypeName: string | null;
  }>(
    `SELECT
       u.id,
       u.wing,
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
    amountPerFlatPaise: draft.totalPaise,
    combinedAmountPaise: recipientCount * draft.totalPaise,
    recipients: recipients.rows,
    previewLimit: 50,
    hasMoreRecipients: recipientCount > recipients.rows.length,
  };
}

export async function createInvoiceDraft(
  userId: string,
  societyId: string,
  input: unknown,
) {
  const request = createInvoiceDraftRequestSchema.parse(input);
  const draft = request.draft;

  return withChairmanUnitAccess(userId, societyId, async (client) => {
    const existing = await client.query<{
      id: string;
      status: string;
      sameRequest: boolean;
    }>(
      `SELECT
         d.id,
         d.status,
         EXISTS (
           SELECT 1 FROM invoice_events e
           WHERE e.draft_id = d.id
             AND e.society_id = d.society_id
             AND e.action = 'draft_created'
             AND e.snapshot->'request' = $3::jsonb
         ) AS "sameRequest"
       FROM invoice_drafts d
       WHERE d.society_id = $1 AND d.request_key = $2`,
      [societyId, request.requestKey, JSON.stringify(draft)],
    );

    if (existing.rows[0]) {
      const previous = existing.rows[0];

      if (!previous.sameRequest) {
        throw new InvoiceDraftError(
          "REQUEST_KEY_CONFLICT",
          "This request key was already used for different invoice details.",
          409,
        );
      }

      return {
        draftId: previous.id,
        status: previous.status,
        replayed: true,
      };
    }

    const preview = await previewRecipients(client, societyId, draft);

    if (preview.recipientCount === 0) {
      throw new InvoiceDraftError(
        "NO_RECIPIENTS",
        "There are no registered flats of this unit type.",
        400,
      );
    }

    const result = await client.query<{ id: string; status: string }>(
      `INSERT INTO invoice_drafts (
         society_id, created_by, request_key,
         title, billing_month, due_date,
         target_kind, target_unit_id, target_unit_type_id
       )
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9)
       RETURNING id, status`,
      [
        societyId,
        userId,
        request.requestKey,
        draft.title,
        `${draft.billingMonth}-01`,
        draft.dueDate,
        draft.target.kind,
        draft.target.kind === "unit" ? draft.target.unitId : null,
        draft.target.kind === "unit_type" ? draft.target.unitTypeId : null,
      ],
    );

    const created = result.rows[0];

    for (const [index, line] of draft.lines.entries()) {
      await client.query(
        `INSERT INTO invoice_draft_lines (
           draft_id, position, description, amount_paise
         ) VALUES ($1, $2, $3, $4)`,
        [created.id, index + 1, line.description, line.amountPaise],
      );
    }

    await client.query(
      `INSERT INTO invoice_events (
         society_id, draft_id, actor_user_id, action, snapshot
       ) VALUES ($1, $2, $3, 'draft_created', $4::jsonb)`,
      [
        societyId,
        created.id,
        userId,
        JSON.stringify({
          request: draft,
          recipientCountAtCreation: preview.recipientCount,
        }),
      ],
    );

    return {
      draftId: created.id,
      status: created.status,
      replayed: false,
      preview,
    };
  });
}


const updateInvoiceDraftRequestSchema = z.strictObject({
  requestKey: z.uuid(),
  expectedRevision: z.number().int().min(1).max(2147483646),
  draft: invoiceDraftSchema,
});

export async function updateInvoiceDraft(
  userId: string,
  societyId: string,
  draftId: string,
  input: unknown,
) {
  z.uuid().parse(userId);
  z.uuid().parse(societyId);
  z.uuid().parse(draftId);
  const request = updateInvoiceDraftRequestSchema.parse(input);
  const requestSnapshot = {
    expectedRevision: request.expectedRevision,
    draft: request.draft,
  };

  return withChairmanUnitAccess(userId, societyId, async (client) => {
    const record = await client.query<{
      status: string;
      revision: number;
    }>(
      `SELECT status, revision
       FROM invoice_drafts
       WHERE society_id = $1 AND id = $2
       FOR UPDATE`,
      [societyId, draftId],
    );

    const current = record.rows[0];
    if (!current) {
      throw new InvoiceDraftError(
        "DRAFT_NOT_FOUND",
        "This draft could not be found.",
        404,
      );
    }

    const previous = await client.query<{
      sameRequest: boolean;
      result: {
        draftId: string;
        status: "draft";
        revision: number;
      };
    }>(
      `SELECT
         snapshot->'request' = $4::jsonb AS "sameRequest",
         snapshot->'result' AS result
       FROM invoice_events
       WHERE society_id = $1
         AND draft_id = $2
         AND action = 'draft_updated'
         AND snapshot->>'requestKey' = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [
        societyId,
        draftId,
        request.requestKey,
        JSON.stringify(requestSnapshot),
      ],
    );

    if (previous.rows[0]) {
      if (!previous.rows[0].sameRequest) {
        throw new InvoiceDraftError(
          "REQUEST_KEY_CONFLICT",
          "This save request was already used for different changes.",
          409,
        );
      }
      return { ...previous.rows[0].result, replayed: true };
    }

    if (current.status !== "draft") {
      throw new InvoiceDraftError(
        "DRAFT_NOT_EDITABLE",
        "Only unissued drafts can be edited.",
        409,
      );
    }

    if (current.revision !== request.expectedRevision) {
      throw new InvoiceDraftError(
        "REVISION_CONFLICT",
        "This draft changed elsewhere. Reload it before editing.",
        409,
      );
    }

    const issued = await client.query(
      `SELECT id FROM society_invoices
       WHERE society_id = $1 AND draft_id = $2
       LIMIT 1`,
      [societyId, draftId],
    );
    if (issued.rows.length > 0) {
      throw new InvoiceDraftError(
        "DRAFT_NOT_EDITABLE",
        "This draft already has issued bills.",
        409,
      );
    }

    const draft = request.draft;
    const preview = await previewRecipients(client, societyId, draft);
    if (preview.recipientCount === 0) {
      throw new InvoiceDraftError(
        "NO_RECIPIENTS",
        "No registered flats match the selected recipient.",
        400,
      );
    }

    await client.query(
      `UPDATE invoice_drafts
       SET title = $3,
           billing_month = $4::date,
           due_date = $5::date,
           target_kind = $6,
           target_unit_id = $7,
           target_unit_type_id = $8,
           revision = revision + 1,
           updated_at = clock_timestamp()
       WHERE society_id = $1 AND id = $2`,
      [
        societyId,
        draftId,
        draft.title,
        `${draft.billingMonth}-01`,
        draft.dueDate,
        draft.target.kind,
        draft.target.kind === "unit" ? draft.target.unitId : null,
        draft.target.kind === "unit_type" ? draft.target.unitTypeId : null,
      ],
    );

    await client.query(
      "DELETE FROM invoice_draft_lines WHERE draft_id = $1",
      [draftId],
    );

    for (const [index, line] of draft.lines.entries()) {
      await client.query(
        `INSERT INTO invoice_draft_lines (
           draft_id, position, description, amount_paise
         ) VALUES ($1, $2, $3, $4)`,
        [draftId, index + 1, line.description, line.amountPaise],
      );
    }

    const result = {
      draftId,
      status: "draft" as const,
      revision: current.revision + 1,
    };

    await client.query(
      `INSERT INTO invoice_events (
         society_id, draft_id, actor_user_id, action, snapshot
       ) VALUES ($1, $2, $3, 'draft_updated', $4::jsonb)`,
      [
        societyId,
        draftId,
        userId,
        JSON.stringify({
          requestKey: request.requestKey,
          request: requestSnapshot,
          result,
          recipientCountAtUpdate: preview.recipientCount,
        }),
      ],
    );

    return { ...result, replayed: false };
  });
}
