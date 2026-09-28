import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getDatabase } from "../db";
import type { Portal } from "./session";
import type { MobileSignInResult } from "./services/mobile-session-service";
import {
  createMobileTokenPair,
  hashMobileToken,
  MOBILE_ACCESS_TOKEN_SECONDS,
} from "./mobile-token";
import { insertChairmanMobileSession } from "./repositories/mobile-session-repository";

export class PasswordSessionRejectedError extends Error {
  constructor() {
    super("Account credentials or eligibility changed.");
  }
}

type Input = {
  userId: string;
  expectedPasswordHash: string;
  portal: Portal;
  client: "web" | "android";
};

type Result =
  | { client: "android"; session: MobileSignInResult }
  | {
      client: "web";
      token: string;
      expiresAt: string;
      user: { id: string; fullName: string; portal: Portal };
    };

// Call only after verifying the submitted password against expectedPasswordHash.
export async function createPasswordSession(input: Input): Promise<Result> {
  if (
    !["chairman", "resident", "admin"].includes(input.portal) ||
    !["web", "android"].includes(input.client) ||
    (input.client === "android" && input.portal === "admin")
  ) throw new PasswordSessionRejectedError();

  const client = await getDatabase().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const account = await client.query<{
      id: string;
      fullName: string;
      passwordHash: string | null;
    }>(
      `SELECT u.id, u.full_name AS "fullName",
              u.password_hash AS "passwordHash"
       FROM users u
       WHERE u.id = $1
         AND u.status = 'active'
         AND u.email_verified_at IS NOT NULL
         AND (
           u.phone_verified_at IS NOT NULL
           OR (
             u.verification_policy = 'email_only'
             AND NOT EXISTS (
               SELECT 1 FROM platform_admins a WHERE a.user_id = u.id
             )
           )
         )
         AND (
           ($2 = 'admin' AND EXISTS (
             SELECT 1 FROM platform_admins a WHERE a.user_id = u.id
           ))
           OR ($2 IN ('chairman', 'resident') AND NOT EXISTS (
             SELECT 1 FROM platform_admins a WHERE a.user_id = u.id
           ))
         )
       FOR UPDATE OF u`,
      [input.userId, input.portal],
    );
    const user = account.rows[0];
    if (
      !user || !user.passwordHash ||
      user.passwordHash !== input.expectedPasswordHash
    ) throw new PasswordSessionRejectedError();

    let result: Result;
    if (input.client === "android") {
      if (input.portal === "admin") throw new PasswordSessionRejectedError();
      const tokens = createMobileTokenPair();
      const session = await insertChairmanMobileSession(client, {
        userId: user.id,
        portal: input.portal,
        accessTokenHash: hashMobileToken(tokens.accessToken),
        refreshTokenHash: hashMobileToken(tokens.refreshToken),
        accessLifetimeSeconds: MOBILE_ACCESS_TOKEN_SECONDS,
      });
      result = {
        client: "android",
        session: {
          user: {
            id: user.id, fullName: user.fullName, portal: input.portal,
          },
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenType: "Bearer",
          expiresAt: session.expiresAt.toISOString(),
        },
      };
    } else {
      const token = randomBytes(32).toString("hex");
      const session = await client.query<{ expiresAt: Date }>(
        `INSERT INTO auth_sessions(user_id, token_hash, portal, expires_at)
         VALUES ($1,$2,$3,clock_timestamp() + interval '8 hours')
         RETURNING expires_at AS "expiresAt"`,
        [
          user.id,
          createHash("sha256").update(token).digest("hex"),
          input.portal,
        ],
      );
      result = {
        client: "web",
        token,
        expiresAt: session.rows[0].expiresAt.toISOString(),
        user: { id: user.id, fullName: user.fullName, portal: input.portal },
      };
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
