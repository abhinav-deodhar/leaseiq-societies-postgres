import "server-only";
import type { PoolClient } from "pg";
import type {
  CreateUnitData,
  UnitListQuery,
  UnitListResponse,
  UnitSummary,
  UnitTypeSummary,
} from "@/lib/contracts/units";
import { getDatabase } from "@/lib/server/db";
import { requireChairmanSetupAccess } from "./society-access.service";
import {
  ensureStandardUnitTypes,
  insertUnit,
  insertUnitCreatedEvent,
  listUnits,
  listUnitTypes,
  unitTypeBelongsToSociety,
} from "@/lib/server/repositories/units.repository";
import {
  lockSocietyUnitManagement,
  readUnitCapacity,
  unitAddressExists,
} from "@/lib/server/repositories/unit-capacity.repository";

export class UnitOperationError extends Error {
  constructor(
    readonly code:
      | "DUPLICATE_UNIT"
      | "INVALID_UNIT_TYPE"
      | "UNIT_LIMIT_REACHED"
      | "UNIT_TYPE_LIMIT_REACHED",
    message: string,
  ) {
    super(message);
    this.name = "UnitOperationError";
  }
}

export async function withChairmanUnitAccess<T>(
  userId: string,
  societyId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getDatabase().connect();
  let transactionStarted = false;
  let discardConnection = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    // Serialize unit operations before acquiring access-record locks.
    // This prevents competing additions from using the same capacity.
    await lockSocietyUnitManagement(client, societyId);
    await requireChairmanSetupAccess(client, userId, societyId);
    await ensureStandardUnitTypes(client, societyId);

    const result = await operation(client);

    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discardConnection = true;
      }
    }

    throw error;
  } finally {
    client.release(discardConnection);
  }
}

export async function createUnitInTransaction(
  client: PoolClient,
  authenticatedUserId: string,
  societyId: string,
  data: CreateUnitData,
): Promise<UnitSummary> {
  if (
    data.unitTypeId !== null &&
    !(await unitTypeBelongsToSociety(
      client,
      societyId,
      data.unitTypeId,
    ))
  ) {
    throw new UnitOperationError(
      "INVALID_UNIT_TYPE",
      "Choose a unit type belonging to this society.",
    );
  }

  if (
    await unitAddressExists(
      client,
      societyId,
      data.wing,
      data.flatNumber,
    )
  ) {
    throw new UnitOperationError(
      "DUPLICATE_UNIT",
      "A flat with this number already exists in this wing.",
    );
  }

  const capacity = await readUnitCapacity(
    client,
    societyId,
    data.unitTypeId,
  );

  if (capacity.registeredTotal >= capacity.totalLimit) {
    throw new UnitOperationError(
      "UNIT_LIMIT_REACHED",
      "The register has reached the society's approved unit count. " +
        "Correct existing entries or arrange an approved count update.",
    );
  }

  if (
    capacity.typeLimit !== null &&
    capacity.registeredType >= capacity.typeLimit
  ) {
    throw new UnitOperationError(
      "UNIT_TYPE_LIMIT_REACHED",
      "This unit category has reached its approved count " +
        `(${capacity.typeLimit}). Choose the correct type or arrange ` +
        "an approved count update.",
    );
  }

  const unit = await insertUnit(
    client,
    societyId,
    authenticatedUserId,
    data,
  );

  await insertUnitCreatedEvent(client, unit, authenticatedUserId);
  return unit;
}

export async function createUnitForChairman(
  authenticatedUserId: string,
  societyId: string,
  data: CreateUnitData,
): Promise<UnitSummary> {
  try {
    return await withChairmanUnitAccess(
      authenticatedUserId,
      societyId,
      (client) =>
        createUnitInTransaction(
          client,
          authenticatedUserId,
          societyId,
          data,
        ),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505" &&
      "constraint" in error &&
      error.constraint === "society_units_address_unique"
    ) {
      throw new UnitOperationError(
        "DUPLICATE_UNIT",
        "A flat with this number already exists in this wing.",
      );
    }

    throw error;
  }
}

export async function listUnitsForChairman(
  authenticatedUserId: string,
  societyId: string,
  query: UnitListQuery,
): Promise<UnitListResponse & { unitTypes: UnitTypeSummary[] }> {
  return withChairmanUnitAccess(
    authenticatedUserId,
    societyId,
    async (client) => {
      const pageSize = 50;
      const result = await listUnits(client, societyId, query, pageSize);
      const unitTypes = await listUnitTypes(client, societyId);

      return {
        ...result,
        unitTypes,
        page: query.page,
        pageSize,
      };
    },
  );
}
