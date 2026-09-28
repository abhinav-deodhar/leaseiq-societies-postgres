import { effectiveUnitOccupancySql } from "@/lib/server/repositories/unit-occupancy";
import "server-only";
import type { PoolClient } from "pg";
import type { UnitSummary } from "@/lib/contracts/units";
import type { UpdateUnitData } from "@/lib/contracts/unit-update";

type UnitRow = Omit<UnitSummary, "createdAt"> & {
  createdAt: Date;
};

export async function lockUnitForUpdate(
  client: PoolClient,
  societyId: string,
  unitId: string,
): Promise<UnitSummary | null> {
  const result = await client.query<UnitRow>(
    `SELECT
       u.id,
       u.society_id AS "societyId",
       u.wing,
       u.floor_label AS "floorLabel",
       u.flat_number AS "flatNumber",
       u.unit_type_id AS "unitTypeId",
       t.name AS "unitTypeName",
       ${effectiveUnitOccupancySql} AS "occupancyStatus",
       u.revision,
       u.created_at AS "createdAt"
     FROM society_units u
     LEFT JOIN society_unit_types t
       ON t.id = u.unit_type_id AND t.society_id = u.society_id
     WHERE u.id = $1 AND u.society_id = $2
     FOR UPDATE OF u`,
    [unitId, societyId],
  );

  const row = result.rows[0];

  return row ? {
    ...row,
    createdAt: row.createdAt.toISOString(),
  } : null;
}

export async function anotherUnitUsesAddress(
  client: PoolClient,
  societyId: string,
  unitId: string,
  wing: string,
  flatNumber: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM society_units
       WHERE society_id = $1
         AND id <> $2
         AND lower(btrim(wing)) = lower(btrim($3))
         AND lower(btrim(flat_number)) = lower(btrim($4))
     ) AS "exists"`,
    [societyId, unitId, wing, flatNumber],
  );

  return result.rows[0].exists;
}

export async function findUnitTypeCategory(
  client: PoolClient,
  societyId: string,
  unitTypeId: string,
): Promise<string | null> {
  const result = await client.query<{ category: string }>(
    `SELECT category FROM society_unit_types
     WHERE society_id = $1 AND id = $2
     FOR SHARE`,
    [societyId, unitTypeId],
  );

  return result.rows[0]?.category ?? null;
}

export async function saveUnitUpdate(
  client: PoolClient,
  before: UnitSummary,
  actorUserId: string,
  data: UpdateUnitData,
): Promise<UnitSummary> {
  const updated = await client.query(
    `UPDATE society_units
     SET wing = $3,
         floor_label = $4,
         flat_number = $5,
         unit_type_id = $6,
         revision = revision + 1,
         updated_at = clock_timestamp()
     WHERE id = $1
       AND society_id = $2
       AND revision = $7`,
    [
      before.id,
      before.societyId,
      data.wing,
      data.floorLabel,
      data.flatNumber,
      data.unitTypeId,
      data.expectedRevision,
    ],
  );

  if (updated.rowCount !== 1) {
    throw new Error("Unit update could not be saved.");
  }

  const after = await lockUnitForUpdate(
    client,
    before.societyId,
    before.id,
  );

  if (!after) {
    throw new Error("Updated unit could not be read.");
  }

  await client.query(
    `INSERT INTO unit_events (
       society_id, unit_id, actor_user_id,
       action, unit_revision, snapshot
     )
     VALUES ($1, $2, $3, 'updated', $4, $5::jsonb)`,
    [
      before.societyId,
      before.id,
      actorUserId,
      after.revision,
      JSON.stringify({ before, after }),
    ],
  );

  return after;
}
