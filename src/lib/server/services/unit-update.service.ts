import "server-only";
import type { UpdateUnitData } from "@/lib/contracts/unit-update";
import {
  readUnitCapacity,
} from "@/lib/server/repositories/unit-capacity.repository";
import {
  anotherUnitUsesAddress,
  findUnitTypeCategory,
  lockUnitForUpdate,
  saveUnitUpdate,
} from "@/lib/server/repositories/unit-update.repository";
import {
  UnitOperationError,
  withChairmanUnitAccess,
} from "./units.service";

export class UnitUpdateError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "UnitUpdateError";
  }
}

export async function updateUnitForChairman(
  authenticatedUserId: string,
  societyId: string,
  unitId: string,
  data: UpdateUnitData,
) {
  return withChairmanUnitAccess(
    authenticatedUserId,
    societyId,
    async (client) => {
      const before = await lockUnitForUpdate(client, societyId, unitId);

      if (!before) {
        throw new UnitUpdateError("NOT_FOUND", "Flat not found.");
      }

      if (before.revision !== data.expectedRevision) {
        throw new UnitUpdateError(
          "CONFLICT",
          "This flat has changed. Refresh the register and reopen its edit form.",
        );
      }

      if (
        await anotherUnitUsesAddress(
          client,
          societyId,
          unitId,
          data.wing,
          data.flatNumber,
        )
      ) {
        throw new UnitOperationError(
          "DUPLICATE_UNIT",
          "Another flat already uses this wing and flat number.",
        );
      }

      if (data.unitTypeId !== null) {
        const newCategory = await findUnitTypeCategory(
          client,
          societyId,
          data.unitTypeId,
        );

        if (!newCategory) {
          throw new UnitOperationError(
            "INVALID_UNIT_TYPE",
            "Choose a unit type belonging to this society.",
          );
        }

        const oldCategory = before.unitTypeId
          ? await findUnitTypeCategory(client, societyId, before.unitTypeId)
          : null;

        const capacity = await readUnitCapacity(
          client,
          societyId,
          data.unitTypeId,
        );

        // The count includes this flat when it already occupies the
        // destination category. Exclude it before checking capacity.
        const otherUnitsInCategory = capacity.registeredType -
          (oldCategory === newCategory ? 1 : 0);

        if (
          capacity.typeLimit === null ||
          otherUnitsInCategory >= capacity.typeLimit
        ) {
          throw new UnitOperationError(
            "UNIT_TYPE_LIMIT_REACHED",
            "This category has no remaining approved capacity. " +
              "Choose the correct category or arrange an approved count update.",
          );
        }
      }

      // Editing does not add a physical unit. Allow correction even if
      // legacy data already exceeds the society's aggregate unit count.
      return saveUnitUpdate(
        client,
        before,
        authenticatedUserId,
        data,
      );
    },
  );
}
