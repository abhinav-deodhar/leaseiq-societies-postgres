import "server-only";
import { z } from "zod";
import { HttpError } from "@/lib/server/http";
import { ownerOccupancyUpdateSchema } from "@/lib/contracts/occupancy";
import { withResidentRequestAccess } from "./resident-requests.service";
import { effectiveUnitOccupancyBadgeSql } from "@/lib/server/repositories/unit-occupancy";

export async function ownerOccupancy(user: string, society: string, unit: string, input?: unknown) {
  if (!z.uuid().safeParse(unit).success) throw new HttpError(400, "Choose a valid flat.");
  const update = input === undefined ? null : ownerOccupancyUpdateSchema.parse(input);
  if (update && (update.societyId !== society || update.unitId !== unit)) throw new HttpError(400, "Flat details do not match.");
  return withResidentRequestAccess(user, society, async (client) => {
    const ownership = await client.query<{ id: string }>(
      `SELECT m.id FROM resident_unit_memberships m
       JOIN resident_unit_requests r ON r.id=m.source_request_id AND r.society_id=m.society_id
         AND r.unit_id=m.unit_id AND r.user_id=m.user_id AND r.relationship='owner'
       WHERE m.user_id=$1 AND m.society_id=$2 AND m.unit_id=$3
         AND m.relationship='owner' AND m.status='active' AND r.status='approved'
       ORDER BY m.id LIMIT 1 FOR SHARE OF m,r`, [user, society, unit],
    );
    if (!ownership.rows[0]) throw new HttpError(403, "Only an approved owner can report this flat's occupancy.");
    const locked = await client.query(`SELECT * FROM society_units WHERE id=$1 AND society_id=$2 FOR UPDATE`, [unit, society]);
    const before = locked.rows[0];
    if (!before) throw new HttpError(404, "Flat not found.");
    const current = await client.query<{ badge: string }>(
      `SELECT ${effectiveUnitOccupancyBadgeSql} AS badge FROM society_units u WHERE u.id=$1`, [unit],
    );
    const currentTenancy = await client.query<{
      endDate: string | null;
    }>(
      `SELECT m.tenancy_end_date::text AS "endDate"
       FROM resident_unit_memberships m
       WHERE m.unit_id=$1 AND m.society_id=$2
         AND m.status='active' AND m.relationship='tenant'
         AND (
           m.move_in_date IS NULL OR
           m.move_in_date <=
             (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
         )
         AND (
           m.tenancy_end_date IS NULL OR
           m.tenancy_end_date >=
             (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
         )
       ORDER BY m.tenancy_end_date DESC NULLS FIRST, m.id
       LIMIT 1`,
      [unit, society],
    );
    const occupancyLocked = currentTenancy.rows.length > 0;
    const lockedUntil = currentTenancy.rows[0]?.endDate ?? null;
    if (!update) return {
      badge: occupancyLocked ? "CR" : current.rows[0].badge,
      revision: before.revision as number,
      occupancyLocked,
      lockedUntil,
    };
    if (occupancyLocked) {
      throw new HttpError(
        409,
        lockedUntil
          ? `Occupancy is locked through ${lockedUntil} while the tenant's agreement is active.`
          : "Occupancy is locked while the tenant's agreement is active. No end date is recorded.",
      );
    }
    if (before.revision !== update.expectedRevision) throw new HttpError(409, "The flat changed. Reload its occupancy before saving.");
    const residentOwner = await client.query(
      `SELECT 1 FROM resident_unit_memberships m JOIN resident_unit_requests r ON r.id=m.source_request_id
       WHERE m.unit_id=$1 AND m.society_id=$2 AND m.status='active' AND m.relationship='owner'
         AND r.status='approved' AND r.applicant_profile->'residesInFlat'='true'::jsonb
         AND (m.move_in_date IS NULL OR m.move_in_date <= (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date)
       LIMIT 1`, [unit, society],
    );
    if (residentOwner.rowCount) throw new HttpError(409, "This flat has a resident owner. Their residence record must be updated before reporting a different occupancy.");
    const tenants = await client.query(
      `SELECT 1 FROM resident_unit_memberships WHERE unit_id=$1 AND society_id=$2
       AND status='active' AND relationship='tenant'
       AND (move_in_date IS NULL OR move_in_date <= (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date)
       AND (tenancy_end_date IS NULL OR tenancy_end_date >= (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date) LIMIT 1`,
      [unit, society],
    );
    if (tenants.rowCount && update.occupancy !== "CR") throw new HttpError(409, "A current tenant is registered. End that tenancy before reporting the flat as no longer rented.");
    if (before.owner_occupancy_report === update.occupancy && before.occupancy_report_membership_id === ownership.rows[0].id) {
      return { badge: current.rows[0].badge, revision: before.revision as number };
    }
    const saved = await client.query(
      `UPDATE society_units SET owner_occupancy_report=$3, occupancy_report_membership_id=$4,
       occupancy_reported_at=clock_timestamp(), revision=revision+1, updated_at=clock_timestamp()
       WHERE id=$1 AND society_id=$2 RETURNING *`, [unit, society, update.occupancy, ownership.rows[0].id],
    );
    await client.query(
      `INSERT INTO unit_events(society_id,unit_id,actor_user_id,action,unit_revision,snapshot)
       VALUES($1,$2,$3,'occupancy_updated',$4,$5::jsonb)`,
      [society, unit, user, saved.rows[0].revision, JSON.stringify({ before, after: saved.rows[0], source: "owner_report" })],
    );
    return { badge: update.occupancy, revision: saved.rows[0].revision as number };
  });
}
