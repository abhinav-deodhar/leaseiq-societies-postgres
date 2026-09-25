import "server-only";
import type { PoolClient } from "pg";

export type LockedMobileSession = {
  mobileSessionId: string;
  userId: string;
  fullName: string;
  portal: string;
  revokedAt: Date | null;
  eligible: boolean;
};

export type StoredRefreshToken = {
  consumedAt: Date | null;
  replacementTokenHash: string | null;
};

// Every renewal operation must first take this parent-session lock.
// The caller must keep the transaction open until renewal finishes.
export async function lockMobileSessionForRefresh(
  client: PoolClient,
  refreshTokenHash: string,
): Promise<LockedMobileSession | null> {
  const result = await client.query<LockedMobileSession>(
    `SELECT
       m.id AS "mobileSessionId",
       u.id AS "userId",
       u.full_name AS "fullName",
       m.portal,
       m.revoked_at AS "revokedAt",
       (
         u.status = 'active'
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
       ) AS eligible
     FROM mobile_sessions m
     JOIN users u ON u.id = m.user_id
     WHERE EXISTS (
       SELECT 1
       FROM mobile_refresh_tokens r
       WHERE r.mobile_session_id = m.id
         AND r.token_hash = $1
     )
     FOR UPDATE OF m, u`,
    [refreshTokenHash],
  );

  return result.rows[0] ?? null;
}

// Read this after acquiring the parent lock, so a completed concurrent
// rotation is visible to this transaction.
export async function findSessionRefreshToken(
  client: PoolClient,
  mobileSessionId: string,
  tokenHash: string,
): Promise<StoredRefreshToken | null> {
  const result = await client.query<StoredRefreshToken>(
    `SELECT
       consumed_at AS "consumedAt",
       replacement_token_hash AS "replacementTokenHash"
     FROM mobile_refresh_tokens
     WHERE mobile_session_id = $1
       AND token_hash = $2`,
    [mobileSessionId, tokenHash],
  );

  return result.rows[0] ?? null;
}

// Check before consuming the old token. A token hash must not already
// belong to this session or any other session.
export async function refreshTokenHashExists(
  client: PoolClient,
  tokenHash: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM mobile_refresh_tokens
       WHERE token_hash = $1
     ) AS "exists"`,
    [tokenHash],
  );

  return result.rows[0].exists;
}

export async function rotateSessionRefreshToken(
  client: PoolClient,
  input: {
    mobileSessionId: string;
    currentTokenHash: string;
    replacementTokenHash: string;
  },
): Promise<void> {
  const consumed = await client.query(
    `UPDATE mobile_refresh_tokens
     SET consumed_at = clock_timestamp(),
         replacement_token_hash = $3
     WHERE mobile_session_id = $1
       AND token_hash = $2
       AND consumed_at IS NULL
       AND replacement_token_hash IS NULL`,
    [
      input.mobileSessionId,
      input.currentTokenHash,
      input.replacementTokenHash,
    ],
  );

  if (consumed.rowCount !== 1) {
    throw new Error("Refresh token rotation could not be completed.");
  }

  await client.query(
    `INSERT INTO mobile_refresh_tokens (
       token_hash,
       mobile_session_id
     )
     VALUES ($1, $2)`,
    [input.replacementTokenHash, input.mobileSessionId],
  );

  await client.query(
    `UPDATE mobile_sessions
     SET last_refreshed_at = clock_timestamp()
     WHERE id = $1`,
    [input.mobileSessionId],
  );
}

export async function insertRenewedMobileAccessToken(
  client: PoolClient,
  input: {
    mobileSessionId: string;
    userId: string;
    accessTokenHash: string;
    accessLifetimeSeconds: number;
  },
): Promise<Date> {
  const result = await client.query<{ expiresAt: Date }>(
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
       (
         SELECT portal
         FROM mobile_sessions
         WHERE id = $4
           AND user_id = $1
           AND revoked_at IS NULL
       ),
       clock_timestamp() + ($3::integer * INTERVAL '1 second'),
       $4
     )
     RETURNING expires_at AS "expiresAt"`,
    [
      input.userId,
      input.accessTokenHash,
      input.accessLifetimeSeconds,
      input.mobileSessionId,
    ],
  );

  return result.rows[0].expiresAt;
}

// The caller must hold the parent-session lock and commit this change
// even when the renewal request is rejected for token reuse.
export async function revokeMobileSession(
  client: PoolClient,
  mobileSessionId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE mobile_sessions
     SET revoked_at = clock_timestamp(),
         revocation_reason = $2
     WHERE id = $1
       AND revoked_at IS NULL`,
    [mobileSessionId, reason],
  );

  await client.query(
    `UPDATE auth_sessions
     SET revoked_at = clock_timestamp()
     WHERE mobile_session_id = $1
       AND revoked_at IS NULL`,
    [mobileSessionId],
  );
}
