import "server-only";
import type { PoolClient } from "pg";
import type {
  CreateUnitData,
  UnitListQuery,
  UnitSummary,
  UnitTypeSummary,
} from "@/lib/contracts/units";

type UnitRow = Omit<UnitSummary, "createdAt"> & {
  createdAt: Date;
};

const unitColumns = `
  u.id,
  u.society_id AS "societyId",
  u.wing,
  u.floor_label AS "floorLabel",
  u.flat_number AS "flatNumber",
  u.unit_type_id AS "unitTypeId",
  t.name AS "unitTypeName",
  u.occupancy_status AS "occupancyStatus",
  u.revision,
  u.created_at AS "createdAt"
`;

function serializeUnit(row: UnitRow): UnitSummary {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function ensureStandardUnitTypes(
  client: PoolClient,
  societyId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO society_unit_types (society_id, name, category)
     SELECT $1::uuid, types.name, types.category
     FROM (
       VALUES
         ('Studio / 1 RK', 'studio'),
         ('1 BHK', 'one_bhk'),
         ('2 BHK', 'two_bhk'),
         ('3 BHK', 'three_bhk'),
         ('4+ BHK', 'four_plus_bhk')
     ) AS types(name, category)
     ON CONFLICT DO NOTHING`,
    [societyId],
  );
}

export async function listUnitTypes(
  client: PoolClient,
  societyId: string,
): Promise<UnitTypeSummary[]> {
  const result = await client.query<UnitTypeSummary>(
    `SELECT id, name, category
     FROM society_unit_types
     WHERE society_id = $1
     ORDER BY
       CASE category
         WHEN 'studio' THEN 1
         WHEN 'one_bhk' THEN 2
         WHEN 'two_bhk' THEN 3
         WHEN 'three_bhk' THEN 4
         WHEN 'four_plus_bhk' THEN 5
         ELSE 6
       END,
       lower(name),
       id`,
    [societyId],
  );

  return result.rows;
}

export async function unitTypeBelongsToSociety(
  client: PoolClient,
  societyId: string,
  unitTypeId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT id
     FROM society_unit_types
     WHERE id = $1 AND society_id = $2
     FOR SHARE`,
    [unitTypeId, societyId],
  );

  return result.rowCount === 1;
}

export async function insertUnit(
  client: PoolClient,
  societyId: string,
  userId: string,
  data: CreateUnitData,
): Promise<UnitSummary> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO society_units (
       society_id, unit_type_id, wing, floor_label,
       flat_number, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      societyId,
      data.unitTypeId,
      data.wing,
      data.floorLabel,
      data.flatNumber,
      userId,
    ],
  );

  const result = await client.query<UnitRow>(
    `SELECT ${unitColumns}
     FROM society_units u
     LEFT JOIN society_unit_types t
       ON t.id = u.unit_type_id AND t.society_id = u.society_id
     WHERE u.id = $1 AND u.society_id = $2`,
    [inserted.rows[0].id, societyId],
  );

  return serializeUnit(result.rows[0]);
}

export async function insertUnitCreatedEvent(
  client: PoolClient,
  unit: UnitSummary,
  userId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO unit_events (
       society_id, unit_id, actor_user_id,
       action, unit_revision, snapshot
     )
     VALUES ($1, $2, $3, 'created', $4, $5::jsonb)`,
    [
      unit.societyId,
      unit.id,
      userId,
      unit.revision,
      JSON.stringify(unit),
    ],
  );
}

export async function listUnits(
  client: PoolClient,
  societyId: string,
  query: UnitListQuery,
  pageSize: number,
): Promise<{ units: UnitSummary[]; total: number }> {
  const filter = `
    u.society_id = $1
    AND (
      $2::text = ''
      OR position(
        lower($2::text)
        IN lower(concat_ws(' ', u.wing, u.floor_label, u.flat_number))
      ) > 0
    )
  `;

  const count = await client.query<{ total: number }>(
    `SELECT COUNT(*)::integer AS total
     FROM society_units u
     WHERE ${filter}`,
    [societyId, query.search],
  );

  const result = await client.query<UnitRow>(
    `SELECT ${unitColumns}
     FROM society_units u
     LEFT JOIN society_unit_types t
       ON t.id = u.unit_type_id AND t.society_id = u.society_id
     WHERE ${filter}
     ORDER BY lower(u.wing), lower(u.flat_number), u.id
     LIMIT $3 OFFSET $4`,
    [
      societyId,
      query.search,
      pageSize,
      (query.page - 1) * pageSize,
    ],
  );

  return {
    units: result.rows.map(serializeUnit),
    total: count.rows[0].total,
  };
}
