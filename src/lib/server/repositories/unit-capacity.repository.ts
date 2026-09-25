import "server-only";
import type { PoolClient } from "pg";

export type UnitCapacity = {
  totalLimit: number;
  registeredTotal: number;
  typeLimit: number | null;
  registeredType: number;
};

// Acquire before other unit-management locks. Every create, edit,
// and import operation must use this same society-level lock.
export async function lockSocietyUnitManagement(
  client: PoolClient,
  societyId: string,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    [`society-units:${societyId}`],
  );
}

export async function unitAddressExists(
  client: PoolClient,
  societyId: string,
  wing: string,
  flatNumber: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM society_units
       WHERE society_id = $1
         AND lower(btrim(wing)) = lower(btrim($2))
         AND lower(btrim(flat_number)) = lower(btrim($3))
     ) AS "exists"`,
    [societyId, wing, flatNumber],
  );

  return result.rows[0].exists;
}

export async function readUnitCapacity(
  client: PoolClient,
  societyId: string,
  unitTypeId: string | null,
): Promise<UnitCapacity> {
  const result = await client.query<UnitCapacity>(
    `SELECT
       s.total_units AS "totalLimit",
       (
         SELECT COUNT(*)::integer
         FROM society_units u
         WHERE u.society_id = s.id
       ) AS "registeredTotal",
       CASE t.category
         WHEN 'studio' THEN s.studio_units
         WHEN 'one_bhk' THEN s.one_bhk_units
         WHEN 'two_bhk' THEN s.two_bhk_units
         WHEN 'three_bhk' THEN s.three_bhk_units
         WHEN 'four_plus_bhk' THEN s.four_plus_bhk_units
         WHEN 'custom' THEN s.other_residential_units
         ELSE NULL
       END AS "typeLimit",
       (
         SELECT COUNT(*)::integer
         FROM society_units u
         JOIN society_unit_types existing_type
           ON existing_type.id = u.unit_type_id
           AND existing_type.society_id = u.society_id
         WHERE u.society_id = s.id
           AND existing_type.category = t.category
       ) AS "registeredType"
     FROM societies s
     LEFT JOIN society_unit_types t
       ON t.id = $2::uuid AND t.society_id = s.id
     WHERE s.id = $1`,
    [societyId, unitTypeId],
  );

  const capacity = result.rows[0];

  if (!capacity) {
    throw new Error("Society capacity could not be read.");
  }

  return capacity;
}
