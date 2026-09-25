import "server-only";
import type { PoolClient } from "pg";
import { getDatabase } from "@/lib/server/db";
import {
  createMobileTokenPair,
  hashMobileToken,
  isValidMobileToken,
  MOBILE_ACCESS_TOKEN_SECONDS,
} from "@/lib/server/auth/mobile-token";
import {
  findSessionRefreshToken,
  insertRenewedMobileAccessToken,
  lockMobileSessionForRefresh,
  refreshTokenHashExists,
  revokeMobileSession,
  rotateSessionRefreshToken,
} from "@/lib/server/auth/repositories/mobile-refresh-repository";
import type { MobileSignInResult } from "./mobile-session-service";

export type MobileRefreshFailure =
  | "invalid_request"
  | "invalid_session"
  | "account_not_allowed"
  | "token_reuse"
  | "stale_retry"
  | "replacement_conflict";

export type MobileRefreshResult =
  | {
      ok: true;
      session: MobileSignInResult;
    }
  | {
      ok: false;
      reason: MobileRefreshFailure;
    };

type ValidatedRefreshInput = {
  currentTokenHash: string;
  replacementTokenHash: string;
  replacementRefreshToken: string;
};

async function renewWithinTransaction(
  client: PoolClient,
  input: ValidatedRefreshInput,
): Promise<MobileRefreshResult> {
  const session = await lockMobileSessionForRefresh(
    client,
    input.currentTokenHash,
  );

  if (
    !session ||
    (session.portal !== "chairman" && session.portal !== "resident") ||
    session.revokedAt !== null
  ) {
    return { ok: false, reason: "invalid_session" };
  }

  if (!session.eligible) {
    await revokeMobileSession(
      client,
      session.mobileSessionId,
      "account_not_allowed",
    );

    return { ok: false, reason: "account_not_allowed" };
  }

  const current = await findSessionRefreshToken(
    client,
    session.mobileSessionId,
    input.currentTokenHash,
  );

  if (!current) {
    return { ok: false, reason: "invalid_session" };
  }

  if (current.consumedAt !== null) {
    if (current.replacementTokenHash !== input.replacementTokenHash) {
      await revokeMobileSession(
        client,
        session.mobileSessionId,
        "refresh_token_reuse",
      );

      return { ok: false, reason: "token_reuse" };
    }

    const replacement = await findSessionRefreshToken(
      client,
      session.mobileSessionId,
      input.replacementTokenHash,
    );

    if (!replacement || replacement.consumedAt !== null) {
      // This exact rotation happened earlier, but the session has
      // already advanced again. Do not revoke it or rotate backward.
      return { ok: false, reason: "stale_retry" };
    }

    // The original response may have been lost. The matching successor
    // is still current, so issue access without rotating again.
  } else {
    if (
      await refreshTokenHashExists(client, input.replacementTokenHash)
    ) {
      return { ok: false, reason: "replacement_conflict" };
    }

    await rotateSessionRefreshToken(client, {
      mobileSessionId: session.mobileSessionId,
      currentTokenHash: input.currentTokenHash,
      replacementTokenHash: input.replacementTokenHash,
    });
  }

  const accessToken = createMobileTokenPair().accessToken;

  const expiresAt = await insertRenewedMobileAccessToken(client, {
    mobileSessionId: session.mobileSessionId,
    userId: session.userId,
    accessTokenHash: hashMobileToken(accessToken),
    accessLifetimeSeconds: MOBILE_ACCESS_TOKEN_SECONDS,
  });

  return {
    ok: true,
    session: {
      user: {
        id: session.userId,
        fullName: session.fullName,
        portal: session.portal,
      },
      accessToken,
      refreshToken: input.replacementRefreshToken,
      tokenType: "Bearer",
      expiresAt: expiresAt.toISOString(),
    },
  };
}

export async function refreshChairmanMobileSession(
  currentRefreshToken: unknown,
  replacementRefreshToken: unknown,
): Promise<MobileRefreshResult> {
  if (
    !isValidMobileToken(currentRefreshToken) ||
    !isValidMobileToken(replacementRefreshToken) ||
    currentRefreshToken === replacementRefreshToken
  ) {
    return { ok: false, reason: "invalid_request" };
  }

  const input: ValidatedRefreshInput = {
    currentTokenHash: hashMobileToken(currentRefreshToken),
    replacementTokenHash: hashMobileToken(replacementRefreshToken),
    replacementRefreshToken,
  };

  const client = await getDatabase().connect();
  let transactionStarted = false;
  let discardConnection = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const result = await renewWithinTransaction(client, input);

    // Expected refusals are returned as values. Commit them so a
    // security revocation is preserved instead of rolled back.
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
