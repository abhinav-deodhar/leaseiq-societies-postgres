import "server-only";
import type { PoolClient } from "pg";
import {
  unitDeletionRequestSchema,
  unitDeletionTargetSchema,
  type UnitDeletionRequest,
  type UnitDeletionTarget,
  type UnitDeletionRow,
  type UnitDeletionPreview,
} from "@/lib/contracts/unit-deletion";
import { withChairmanUnitAccess } from "./units.service";

export class UnitDeletionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "UnitDeletionError";
  }
}

type Snapshot = { societyName: string; rows: UnitDeletionRow[] };

async function inspect(
  client: PoolClient,
  societyId: string,
  target: UnitDeletionTarget,
): Promise<Snapshot> {
  const society = await client.query<{ name: string }>(
    "SELECT name FROM societies WHERE id = $1 FOR SHARE", [societyId],
  );
  if (!society.rows[0]) throw new UnitDeletionError(404, "Society not found.");

  // Row locks also serialize against FK inserts referencing these units.
  // Read dependencies in a separate statement AFTER acquiring those locks.
  const units = await client.query<{
    id: string; wing: string; flatNumber: string; revision: number;
    occupancy: string;
  }>(
    `SELECT id, wing, flat_number AS "flatNumber", revision,
       occupancy_status AS occupancy
     FROM society_units
     WHERE society_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
     ORDER BY id FOR UPDATE`,
    [societyId, target.scope === "all" ? null : target.ids],
  );
  if (target.scope === "selected" && units.rows.length !== target.ids.length) {
    throw new UnitDeletionError(409, "Some selected flats are no longer available. Refresh the register.");
  }

  const dependencies = await client.query<{ id: string; reasons: string[] }>(
    `SELECT u.id, array_remove(ARRAY[
       CASE WHEN EXISTS (SELECT 1 FROM resident_unit_requests r WHERE r.unit_id=u.id)
         THEN 'Resident application history' END,
       CASE WHEN EXISTS (SELECT 1 FROM resident_unit_memberships r WHERE r.unit_id=u.id)
         THEN 'Owner or tenant membership history' END,
       CASE WHEN EXISTS (SELECT 1 FROM resident_tenancies r WHERE r.unit_id=u.id)
         THEN 'Tenancy history' END,
       CASE WHEN EXISTS (SELECT 1 FROM owner_transfers r WHERE r.unit_id=u.id)
         THEN 'Ownership transfer history' END,
       CASE WHEN EXISTS (SELECT 1 FROM invoice_drafts r WHERE r.target_unit_id=u.id)
         THEN 'Invoice draft history' END,
       CASE WHEN EXISTS (SELECT 1 FROM society_invoices r WHERE r.unit_id=u.id)
         THEN 'Invoice or payment history' END,
       CASE WHEN EXISTS (SELECT 1 FROM invoice_schedules r WHERE r.target_unit_id=u.id)
         THEN 'Invoice schedule history' END,
       CASE WHEN EXISTS (SELECT 1 FROM unit_billing_contacts r WHERE r.unit_id=u.id)
         THEN 'Billing contact history' END
     ], NULL)::text[] AS reasons
     FROM society_units u WHERE u.society_id=$1 AND u.id=ANY($2::uuid[])
     ORDER BY u.id`,
    [societyId, units.rows.map((unit) => unit.id)],
  );
  const byId = new Map(dependencies.rows.map((row) => [row.id, row.reasons]));
  return {
    societyName: society.rows[0].name,
    rows: units.rows.map(({ occupancy, ...unit }) => ({
      ...unit,
      reasons: [
        ...(byId.get(unit.id) ?? []),
        ...(["owner_occupied", "rented"].includes(occupancy) ? ["Unit is marked occupied"] : []),
      ],
    })),
  };
}

export async function manageUnitDeletion(
  userId: string,
  societyId: string,
  input: UnitDeletionRequest,
): Promise<UnitDeletionPreview | { deleted: number; blocked: number }> {
  const request = unitDeletionRequestSchema.parse(input);
  try {
    return await withChairmanUnitAccess(userId, societyId, async (client) => {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      if (request.mode === "preview") {
        const snapshot = await inspect(client, societyId, request.target);
        await client.query(
          "DELETE FROM unit_deletion_previews WHERE actor_user_id=$1 AND expires_at < clock_timestamp()",
          [userId],
        );
        const saved = await client.query<{ id: string; expires: Date }>(
          `INSERT INTO unit_deletion_previews (society_id, actor_user_id, target, snapshot)
           VALUES ($1,$2,$3::jsonb,$4::jsonb) RETURNING id, expires_at AS expires`,
          [societyId, userId, JSON.stringify(request.target), JSON.stringify(snapshot)],
        );
        return {
          ...snapshot,
          previewId: saved.rows[0].id,
          expiresAt: saved.rows[0].expires.toISOString(),
          scope: request.target.scope,
        };
      }

      const saved = await client.query<{ target: UnitDeletionTarget; snapshot: Snapshot }>(
        `SELECT target, snapshot FROM unit_deletion_previews
         WHERE id=$1 AND society_id=$2 AND actor_user_id=$3
           AND consumed_at IS NULL AND expires_at > clock_timestamp()
         FOR UPDATE`,
        [request.previewId, societyId, userId],
      );
      if (!saved.rows[0]) {
        throw new UnitDeletionError(409, "This preview expired or was already used. Create a new preview.");
      }
      const target = unitDeletionTargetSchema.parse(saved.rows[0].target);
      const current = await inspect(client, societyId, target);
      const previous = saved.rows[0].snapshot;
      const unchanged = current.societyName === previous.societyName &&
        current.rows.length === previous.rows.length &&
        current.rows.every((row, index) => {
          const old = previous.rows[index];
          return row.id === old.id && row.revision === old.revision &&
            row.wing === old.wing && row.flatNumber === old.flatNumber &&
            JSON.stringify(row.reasons) === JSON.stringify(old.reasons);
        });
      if (!unchanged) {
        throw new UnitDeletionError(409, "The register or linked records changed. Close this preview and review again. Nothing was deleted.");
      }
      const expected = target.scope === "all" ? current.societyName : "DELETE";
      if (request.confirmation !== expected) {
        throw new UnitDeletionError(400, "The confirmation text does not match.");
      }
      const ids = current.rows.filter((row) => row.reasons.length === 0).map((row) => row.id);
      if (ids.length === 0) throw new UnitDeletionError(409, "There are no eligible flats to delete.");

      // Recheck expiry after waiting for locks. Consumed state rolls back on any failure.
      const consumed = await client.query(
        `UPDATE unit_deletion_previews SET consumed_at=clock_timestamp()
         WHERE id=$1 AND consumed_at IS NULL AND expires_at > clock_timestamp()`,
        [request.previewId],
      );
      if (consumed.rowCount !== 1) throw new UnitDeletionError(409, "Preview expired. Review again.");

      const archived = await client.query(
        `INSERT INTO deleted_unit_history
           (unit_id, society_id, deleted_by, unit_snapshot, event_history)
         SELECT u.id, u.society_id, $3, to_jsonb(u),
           COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.unit_revision, e.id)
             FROM unit_events e WHERE e.unit_id=u.id AND e.society_id=u.society_id), '[]'::jsonb)
         FROM society_units u WHERE u.society_id=$1 AND u.id=ANY($2::uuid[])`,
        [societyId, ids, userId],
      );
      if (archived.rowCount !== ids.length) throw new Error("Deletion archive count mismatch.");
      await client.query(
        "DELETE FROM unit_events WHERE society_id=$1 AND unit_id=ANY($2::uuid[])",
        [societyId, ids],
      );
      // All other foreign keys remain intact. An unexpected dependency rolls back
      // this complete transaction, including audit moves and preview consumption.
      const removed = await client.query(
        "DELETE FROM society_units WHERE society_id=$1 AND id=ANY($2::uuid[])",
        [societyId, ids],
      );
      if (removed.rowCount !== ids.length) throw new Error("Deletion count mismatch.");
      return { deleted: ids.length, blocked: current.rows.length - ids.length };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23503") {
      throw new UnitDeletionError(409, "A flat has linked records and cannot be deleted. Nothing was deleted. Refresh and review again.");
    }
    throw error;
  }
}
