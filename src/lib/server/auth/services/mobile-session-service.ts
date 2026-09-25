import "server-only";
import { getDatabase } from "@/lib/server/db";
import {
  createMobileTokenPair,
  hashMobileToken,
  MOBILE_ACCESS_TOKEN_SECONDS,
} from "@/lib/server/auth/mobile-token";
import {
  insertChairmanMobileSession,
  lockEligibleChairman,
} from "@/lib/server/auth/repositories/mobile-session-repository";

export type MobileSignInResult = {
  user: {
    id: string;
    fullName: string;
    portal: "chairman" | "resident";
  };
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresAt: string;
};

export class MobileSignInNotAllowedError extends Error {
  constructor() {
    super("This account cannot sign in to the app.");
    this.name = "MobileSignInNotAllowedError";
  }
}

// Internal service: call only after successful password verification.
// The user ID must come from that verified account, never directly
// from an untrusted request body.
export async function createMobileSession(
  authenticatedUserId: string,
  portal: "chairman" | "resident",
): Promise<MobileSignInResult> {
  if (portal !== "chairman" && portal !== "resident") {
    throw new TypeError("Unsupported mobile portal.");
  }
  const tokens = createMobileTokenPair();
  const client = await getDatabase().connect();

  let transactionStarted = false;
  let discardConnection = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    // Both portals require a verified, active, non-admin account.
    // Society and flat permissions are checked separately by each service.
    const user = await lockEligibleChairman(
      client,
      authenticatedUserId,
    );

    if (!user) {
      throw new MobileSignInNotAllowedError();
    }

    const session = await insertChairmanMobileSession(client, {
      userId: user.userId,
      portal,
      accessTokenHash: hashMobileToken(tokens.accessToken),
      refreshTokenHash: hashMobileToken(tokens.refreshToken),
      accessLifetimeSeconds: MOBILE_ACCESS_TOKEN_SECONDS,
    });

    const result: MobileSignInResult = {
      user: {
        id: user.userId,
        fullName: user.fullName,
        portal,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: "Bearer",
      expiresAt: session.expiresAt.toISOString(),
    };

    await client.query("COMMIT");
    transactionStarted = false;

    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Do not return a potentially broken connection to the pool.
        discardConnection = true;
      }
    }

    throw error;
  } finally {
    client.release(discardConnection);
  }
}

// Preserve the existing entry point used by chairman login and tests.
export async function createChairmanMobileSession(
  authenticatedUserId: string,
): Promise<MobileSignInResult> {
  return createMobileSession(authenticatedUserId, "chairman");
}
