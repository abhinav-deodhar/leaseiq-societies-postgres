import "server-only";
import { withChairmanUnitAccess } from "./units.service";
import { InvoiceDraftError } from "./invoice-drafts.service";

export async function deleteInvoiceDraft(userId: string, societyId: string, draftId: string) {
  return withChairmanUnitAccess(userId, societyId, async (client) => {
    const result = await client.query<{ status: string }>(
      "SELECT status FROM invoice_drafts WHERE society_id = $1 AND id = $2 FOR UPDATE",
      [societyId, draftId],
    );
    const draft = result.rows[0];
    if (!draft) throw new InvoiceDraftError("DRAFT_NOT_FOUND", "This draft could not be found.", 404);
    if (draft.status === "cancelled") return { deleted: true };
    if (draft.status !== "draft") throw new InvoiceDraftError("DRAFT_ALREADY_ISSUED", "Issued bills cannot be deleted as drafts.", 409);
    const issued = await client.query("SELECT id FROM society_invoices WHERE society_id = $1 AND draft_id = $2 LIMIT 1", [societyId, draftId]);
    if (issued.rowCount) throw new InvoiceDraftError("DRAFT_ALREADY_ISSUED", "This draft has issued bills and cannot be deleted.", 409);
    await client.query("UPDATE invoice_drafts SET status = 'cancelled', revision = revision + 1, updated_at = clock_timestamp() WHERE society_id = $1 AND id = $2", [societyId, draftId]);
    await client.query(`INSERT INTO invoice_events (society_id, draft_id, actor_user_id, action, snapshot)
      VALUES ($1, $2, $3, 'draft_cancelled', '{"reason":"Deleted by chairman"}'::jsonb)`, [societyId, draftId, userId]);
    return { deleted: true };
  });
}

export async function deleteScheduleDraft(userId: string, societyId: string, scheduleId: string) {
  return withChairmanUnitAccess(userId, societyId, async (client) => {
    const result = await client.query<{ status: string; deleted_at: Date | null }>(
      "SELECT status, deleted_at FROM invoice_schedules WHERE society_id=$1 AND id=$2 FOR UPDATE", [societyId,scheduleId]);
    const schedule=result.rows[0];
    if (!schedule) throw new InvoiceDraftError("DRAFT_NOT_FOUND", "This schedule draft could not be found.", 404);
    if (schedule.deleted_at) return { deleted: true };
    if (schedule.status !== "draft") throw new InvoiceDraftError("SCHEDULE_NOT_DRAFT", "Only draft schedules can be deleted. Active schedules must be paused or ended.", 409);
    const runs=await client.query("SELECT id FROM invoice_schedule_runs WHERE society_id=$1 AND schedule_id=$2 LIMIT 1",[societyId,scheduleId]);
    if(runs.rowCount) throw new InvoiceDraftError("SCHEDULE_HAS_RUNS", "A schedule with billing history cannot be deleted.",409);
    await client.query("UPDATE invoice_schedules SET deleted_at=clock_timestamp(), updated_at=clock_timestamp(), revision=revision+1 WHERE society_id=$1 AND id=$2",[societyId,scheduleId]);
    await client.query(`INSERT INTO invoice_schedule_events(society_id,schedule_id,actor_user_id,action,snapshot)
      VALUES($1,$2,$3,'updated','{"reason":"Draft deleted by chairman"}'::jsonb)`,[societyId,scheduleId,userId]);
    return { deleted: true };
  });
}
