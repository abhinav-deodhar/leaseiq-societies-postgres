import "server-only";
import type { PoolClient } from "pg";
import {
  unitImportSchema,
  type UnitImportIssue,
  type UnitImportRequest,
  type UnitImportResult,
} from "@/lib/contracts/unit-import";
import {
  listUnitTypes,
} from "@/lib/server/repositories/units.repository";
import {
  readUnitCapacity,
  unitAddressExists,
} from "@/lib/server/repositories/unit-capacity.repository";
import {
  createUnitInTransaction,
  withChairmanUnitAccess,
} from "./units.service";

async function inspectRows(
  client: PoolClient,
  societyId: string,
  rows: UnitImportRequest["rows"],
): Promise<UnitImportIssue[]> {
  const issues: UnitImportIssue[] = [];
  const types = await listUnitTypes(client, societyId);
  const typeById = new Map(types.map((type) => [type.id, type]));
  const seenAddresses = new Map<string, number>();
  const categoryAdditions = new Map<string, number>();
  const capacityByCategory = new Map<
    string,
    Awaited<ReturnType<typeof readUnitCapacity>>
  >();

  const overall = await readUnitCapacity(client, societyId, null);

  // Use PostgreSQL normalization to match the database's unique index.
  const normalized = await client.query<{
    addressKey: string;
  }>(
    `SELECT jsonb_build_array(
       lower(btrim(item->>'wing')),
       lower(btrim(item->>'flatNumber'))
     )::text AS "addressKey"
     FROM jsonb_array_elements($1::jsonb)
       WITH ORDINALITY AS source(item, position)
     ORDER BY position`,
    [JSON.stringify(rows)],
  );

  for (const [index, row] of rows.entries()) {
    // Spreadsheet row 1 contains headings.
    const rowNumber = index + 2;
    const addressKey = normalized.rows[index].addressKey;
    const firstRow = seenAddresses.get(addressKey);

    if (firstRow !== undefined) {
      issues.push({
        row: rowNumber,
        message: `This wing and flat number duplicates row ${firstRow}.`,
      });
    } else {
      seenAddresses.set(addressKey, rowNumber);

      if (
        await unitAddressExists(
          client,
          societyId,
          row.wing,
          row.flatNumber,
        )
      ) {
        issues.push({
          row: rowNumber,
          message: "This flat already exists in the register.",
        });
      }
    }

    if (overall.registeredTotal + index + 1 > overall.totalLimit) {
      issues.push({
        row: rowNumber,
        message: `The batch exceeds the approved total of ${overall.totalLimit} flats.`,
      });
    }

    if (row.unitTypeId === null) continue;

    const type = typeById.get(row.unitTypeId);

    if (!type) {
      issues.push({
        row: rowNumber,
        message: "Choose a unit type belonging to this society.",
      });
      continue;
    }

    let capacity = capacityByCategory.get(type.category);

    if (!capacity) {
      capacity = await readUnitCapacity(
        client,
        societyId,
        row.unitTypeId,
      );
      capacityByCategory.set(type.category, capacity);
    }

    const additions = (categoryAdditions.get(type.category) ?? 0) + 1;
    categoryAdditions.set(type.category, additions);

    if (
      capacity.typeLimit !== null &&
      capacity.registeredType + additions > capacity.typeLimit
    ) {
      issues.push({
        row: rowNumber,
        message:
          `The batch exceeds the approved count of ` +
          `${capacity.typeLimit} for this unit category.`,
      });
    }
  }

  return issues;
}

export async function importUnitsForChairman(
  userId: string,
  societyId: string,
  input: UnitImportRequest,
): Promise<UnitImportResult> {
  const request = unitImportSchema.parse(input);

  return withChairmanUnitAccess(userId, societyId, async (client) => {
    const issues = await inspectRows(client, societyId, request.rows);

    if (issues.length > 0) {
      return {
        valid: false,
        imported: 0,
        rowCount: request.rows.length,
        issues,
      };
    }

    if (request.mode === "preview") {
      return {
        valid: true,
        imported: 0,
        rowCount: request.rows.length,
        issues: [],
      };
    }

    for (const row of request.rows) {
      await createUnitInTransaction(client, userId, societyId, row);
    }

    return {
      valid: true,
      imported: request.rows.length,
      rowCount: request.rows.length,
      issues: [],
    };
  });
}
