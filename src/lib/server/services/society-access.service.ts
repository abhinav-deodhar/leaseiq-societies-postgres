import "server-only";
import type { PoolClient } from "pg";
import {
  lockChairmanSetupAccess,
  type ChairmanSetupAccess,
} from "@/lib/server/repositories/society-access.repository";

export class SocietyAccessError extends Error {
  readonly code = "FORBIDDEN";

  constructor() {
    super("You do not have permission to manage this society.");
    this.name = "SocietyAccessError";
  }
}

export async function requireChairmanSetupAccess(
  client: PoolClient,
  authenticatedUserId: string,
  societyId: string,
): Promise<ChairmanSetupAccess> {
  const access = await lockChairmanSetupAccess(
    client,
    authenticatedUserId,
    societyId,
  );

  if (!access) {
    // Use the same response for missing and inaccessible societies.
    throw new SocietyAccessError();
  }

  return access;
}
