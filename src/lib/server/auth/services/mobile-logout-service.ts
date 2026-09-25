import "server-only";
import { getDatabase } from "@/lib/server/db";
import {
  hashMobileToken,
  isValidMobileToken,
} from "@/lib/server/auth/mobile-token";
import {
  lockMobileSessionForRefresh,
  revokeMobileSession,
} from "@/lib/server/auth/repositories/mobile-refresh-repository";

export async function logoutChairmanMobileSession(
  refreshToken: string,
): Promise<void> {
  if (!isValidMobileToken(refreshToken)) {
    throw new TypeError("Invalid mobile token format.");
  }

  const tokenHash = hashMobileToken(refreshToken);
  const client = await getDatabase().connect();

  let transactionStarted = false;
  let discardConnection = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    // Use the same parent-session lock as refresh so logout and
    // renewal cannot change the session independently.
    const session = await lockMobileSessionForRefresh(
      client,
      tokenHash,
    );

    // A consumed refresh token can still revoke its own session.
    // This also handles logout after a renewal response was lost.
    // Logout remains available for disabled accounts.
    if (
      session &&
      (session.portal === "chairman" || session.portal === "resident")
    ) {
      await revokeMobileSession(
        client,
        session.mobileSessionId,
        "user_logout",
      );
    }

    // Unknown or already-revoked sessions are successful no-ops.
    await client.query("COMMIT");
    transactionStarted = false;
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
