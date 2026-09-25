import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getDatabase } from "../src/lib/server/db";
import {
  createMobileTokenPair,
  hashMobileToken,
  MOBILE_ACCESS_TOKEN_SECONDS,
} from "../src/lib/server/auth/mobile-token";
import {
  insertChairmanMobileSession,
  lockEligibleChairman,
} from "../src/lib/server/auth/repositories/mobile-session-repository";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import(
  "@next/env"
);

test("mobile session database behaviour", async (t) => {
  assert.notEqual(
    process.env.NODE_ENV,
    "production",
    "Never run this test in production.",
  );

  loadEnvConfig(process.cwd(), true);

  assert.notEqual(
    process.env.NODE_ENV,
    "production",
    "Never run this test in production.",
  );

  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(
      process.env.PGHOST ?? "",
    ),
    "This test requires a local database.",
  );

  assert.equal(
    process.env.PGDATABASE,
    "leaseiq_societies_dev",
    "This test requires leaseiq_societies_dev.",
  );

  const pool = getDatabase();

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const userId = randomUUID();
      const phone = `+919${randomInt(100_000_000, 1_000_000_000)}`;

      await client.query(
        `INSERT INTO users (
           id, full_name, email, phone, date_of_birth,
           status, email_verified_at, phone_verified_at
         )
         VALUES (
           $1, 'Mobile Session Test', $2, $3, '1990-01-01',
           'active', clock_timestamp(), clock_timestamp()
         )`,
        [userId, `mobile-test-${userId}@example.invalid`, phone],
      );

      await t.test("verified non-admin account is eligible", async () => {
        const user = await lockEligibleChairman(client, userId);

        assert.equal(user?.userId, userId);
        assert.equal(user?.fullName, "Mobile Session Test");
      });

      await t.test("disabled account is rejected", async () => {
        await client.query(
          "UPDATE users SET status = 'disabled' WHERE id = $1",
          [userId],
        );

        assert.equal(await lockEligibleChairman(client, userId), null);

        await client.query(
          "UPDATE users SET status = 'active' WHERE id = $1",
          [userId],
        );
      });

      await t.test("unverified account is rejected", async () => {
        await client.query(
          `UPDATE users
           SET status = 'pending_verification',
               phone_verified_at = NULL
           WHERE id = $1`,
          [userId],
        );

        assert.equal(await lockEligibleChairman(client, userId), null);

        await client.query(
          `UPDATE users
           SET status = 'active',
               phone_verified_at = clock_timestamp()
           WHERE id = $1`,
          [userId],
        );
      });

      await t.test("platform administrator is rejected", async () => {
        await client.query(
          "INSERT INTO platform_admins (user_id) VALUES ($1)",
          [userId],
        );

        assert.equal(await lockEligibleChairman(client, userId), null);

        await client.query(
          "DELETE FROM platform_admins WHERE user_id = $1",
          [userId],
        );
      });

      const tokens = createMobileTokenPair();
      let mobileSessionId: string | undefined;

      await t.test("session stores hashes and expiring access", async () => {
        const session = await insertChairmanMobileSession(client, {
          userId,
          accessTokenHash: hashMobileToken(tokens.accessToken),
          refreshTokenHash: hashMobileToken(tokens.refreshToken),
          accessLifetimeSeconds: MOBILE_ACCESS_TOKEN_SECONDS,
        });

        mobileSessionId = session.mobileSessionId;

        const result = await client.query<{
          accessHash: string;
          refreshHash: string;
          portal: string;
          revokedAt: Date | null;
          remainingSeconds: number;
        }>(
          `SELECT
             a.token_hash AS "accessHash",
             r.token_hash AS "refreshHash",
             m.portal,
             m.revoked_at AS "revokedAt",
             EXTRACT(EPOCH FROM (
               a.expires_at - clock_timestamp()
             ))::double precision AS "remainingSeconds"
           FROM mobile_sessions m
           JOIN auth_sessions a ON a.mobile_session_id = m.id
           JOIN mobile_refresh_tokens r ON r.mobile_session_id = m.id
           WHERE m.id = $1 AND m.user_id = $2`,
          [mobileSessionId, userId],
        );

        assert.equal(result.rowCount, 1);
        const row = result.rows[0];

        assert.equal(row.accessHash, hashMobileToken(tokens.accessToken));
        assert.equal(row.refreshHash, hashMobileToken(tokens.refreshToken));
        assert.notEqual(row.accessHash, tokens.accessToken);
        assert.notEqual(row.refreshHash, tokens.refreshToken);
        assert.equal(row.portal, "chairman");
        assert.equal(row.revokedAt, null);
        assert.ok(row.remainingSeconds > 0);
        assert.ok(row.remainingSeconds <= MOBILE_ACCESS_TOKEN_SECONDS);
      });

      await t.test("duplicate current refresh token is rejected", async () => {
        assert.ok(mobileSessionId);
        await client.query("SAVEPOINT duplicate_refresh");

        try {
          await assert.rejects(
            client.query(
              `INSERT INTO mobile_refresh_tokens (
                 token_hash, mobile_session_id
               ) VALUES ($1, $2)`,
              [
                hashMobileToken(createMobileTokenPair().refreshToken),
                mobileSessionId,
              ],
            ),
            { code: "23505" },
          );
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT duplicate_refresh");
          await client.query("RELEASE SAVEPOINT duplicate_refresh");
        }
      });

      await t.test("failed creation can roll back all its records", async () => {
        const countSessions = async () => {
          const result = await client.query<{ count: number }>(
            `SELECT COUNT(*)::integer AS count
             FROM mobile_sessions WHERE user_id = $1`,
            [userId],
          );

          return result.rows[0].count;
        };

        const before = await countSessions();
        await client.query("SAVEPOINT failed_creation");

        try {
          await assert.rejects(
            insertChairmanMobileSession(client, {
              userId,
              accessTokenHash: "invalid-hash",
              refreshTokenHash: hashMobileToken(
                createMobileTokenPair().refreshToken,
              ),
              accessLifetimeSeconds: MOBILE_ACCESS_TOKEN_SECONDS,
            }),
            { code: "23514" },
          );
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT failed_creation");
          await client.query("RELEASE SAVEPOINT failed_creation");
        }

        assert.equal(await countSessions(), before);

        const refreshCount = await client.query<{ count: number }>(
          `SELECT COUNT(*)::integer AS count
           FROM mobile_refresh_tokens r
           JOIN mobile_sessions m ON m.id = r.mobile_session_id
           WHERE m.user_id = $1`,
          [userId],
        );

        assert.equal(refreshCount.rows[0].count, 1);
      });
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
});
