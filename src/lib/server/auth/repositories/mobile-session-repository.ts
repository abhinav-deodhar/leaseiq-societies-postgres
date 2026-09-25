import "server-only";
import type { PoolClient } from "pg";

type EligibleChairman = {
  userId: string;
  fullName: string;
};

type InsertMobileSessionInput = {
  portal?: "chairman" | "resident";
  userId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessLifetimeSeconds: number;
};

export async function lockEligibleChairman(
  client: PoolClient,
  userId: string,
): Promise<EligibleChairman | null> {
  const result = await client.query<EligibleChairman>(
    `SELECT
       u.id AS "userId",
       u.full_name AS "fullName"
     FROM users u
     WHERE u.id = $1
       AND u.status = 'active'
       AND u.email_verified_at IS NOT NULL
       AND (
         u.phone_verified_at IS NOT NULL
         OR (
           u.verification_policy = 'email_only'
           AND NOT EXISTS (
             SELECT 1 FROM platform_admins verification_admin
             WHERE verification_admin.user_id = u.id
           )
         )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM platform_admins a
         WHERE a.user_id = u.id
       )
     FOR UPDATE OF u`,
    [userId],
  );

  return result.rows[0] ?? null;
}

export async function insertChairmanMobileSession(
  client: PoolClient,
  input: InsertMobileSessionInput,
): Promise<{ mobileSessionId: string; expiresAt: Date }> {
  const portal = input.portal ?? "chairman";
  if (portal !== "chairman" && portal !== "resident") {
    throw new TypeError("Unsupported mobile portal.");
  }
  const sessionResult = await client.query<{ id: string }>(
    `INSERT INTO mobile_sessions (user_id, portal)
     VALUES ($1, $2)
     RETURNING id`,
    [input.userId, portal],
  );

  const mobileSessionId = sessionResult.rows[0].id;

  await client.query(
    `INSERT INTO mobile_refresh_tokens (
       token_hash,
       mobile_session_id
     )
     VALUES ($1, $2)`,
    [input.refreshTokenHash, mobileSessionId],
  );

  const accessResult = await client.query<{ expiresAt: Date }>(
    `INSERT INTO auth_sessions (
       user_id,
       token_hash,
       portal,
       expires_at,
       mobile_session_id
     )
     VALUES (
       $1,
       $2,
       $5,
       clock_timestamp() + ($3::integer * INTERVAL '1 second'),
       $4
     )
     RETURNING expires_at AS "expiresAt"`,
    [
      input.userId,
      input.accessTokenHash,
      input.accessLifetimeSeconds,
      mobileSessionId,
      portal,
    ],
  );

  return {
    mobileSessionId,
    expiresAt: accessResult.rows[0].expiresAt,
  };
}
