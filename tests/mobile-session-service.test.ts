import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getDatabase } from "../src/lib/server/db";
import { getSessionFromToken } from "../src/lib/server/auth/session";
import {
  createChairmanMobileSession,
  createMobileSession,
  MobileSignInNotAllowedError,
} from "../src/lib/server/auth/services/mobile-session-service";

import { createMobileTokenPair } from "../src/lib/server/auth/mobile-token";
import { refreshChairmanMobileSession } from "../src/lib/server/auth/services/mobile-refresh-service";
import { logoutChairmanMobileSession } from "../src/lib/server/auth/services/mobile-logout-service";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import(
  "@next/env"
);

test("mobile service and session validation", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");

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
  const userId = randomUUID();
  let fixtureCreated = false;

  try {
    await pool.query(
      `INSERT INTO users (
         id, full_name, email, phone, date_of_birth,
         status, email_verified_at, phone_verified_at
       )
       VALUES (
         $1, 'Mobile Service Test', $2, $3, '1990-01-01',
         'active', clock_timestamp(), clock_timestamp()
       )`,
      [
        userId,
        `mobile-service-${userId}@example.invalid`,
        `+919${randomInt(100_000_000, 1_000_000_000)}`,
      ],
    );

    fixtureCreated = true;

    await t.test("resident access is isolated from chairman and admin", async () => {
      const resident = await createMobileSession(userId, "resident");

      assert.equal(resident.user.portal, "resident");
      assert.equal(
        (await getSessionFromToken(resident.accessToken, "resident"))?.userId,
        userId,
      );
      assert.equal(
        await getSessionFromToken(resident.accessToken, "chairman"),
        null,
      );
      assert.equal(
        await getSessionFromToken(resident.accessToken, "admin"),
        null,
      );
      assert.equal(
        await getSessionFromToken(resident.refreshToken, "resident"),
        null,
      );

      const chairman = await createChairmanMobileSession(userId);
      assert.equal(
        await getSessionFromToken(chairman.accessToken, "resident"),
        null,
      );
    });

    await t.test("resident renewal and identical retry preserve the portal", async () => {
      const resident = await createMobileSession(userId, "resident");
      const replacement = createMobileTokenPair().refreshToken;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const renewed = await refreshChairmanMobileSession(
          resident.refreshToken,
          replacement,
        );
        assert.ok(renewed.ok);
        if (!renewed.ok) throw new Error("Resident renewal failed.");

        assert.equal(renewed.session.user.portal, "resident");
        assert.equal(
          (await getSessionFromToken(
            renewed.session.accessToken,
            "resident",
          ))?.userId,
          userId,
        );
        assert.equal(
          await getSessionFromToken(renewed.session.accessToken, "chairman"),
          null,
        );
      }
    });

    await t.test("resident logout using a consumed token revokes renewed access", async () => {
      const resident = await createMobileSession(userId, "resident");
      const chairman = await createChairmanMobileSession(userId);
      const replacement = createMobileTokenPair().refreshToken;
      const renewed = await refreshChairmanMobileSession(
        resident.refreshToken,
        replacement,
      );

      assert.ok(renewed.ok);
      if (!renewed.ok) throw new Error("Resident renewal failed.");

      await logoutChairmanMobileSession(resident.refreshToken);

      assert.equal(
        await getSessionFromToken(resident.accessToken, "resident"),
        null,
      );
      assert.equal(
        await getSessionFromToken(renewed.session.accessToken, "resident"),
        null,
      );
      assert.deepEqual(
        await refreshChairmanMobileSession(
          replacement,
          createMobileTokenPair().refreshToken,
        ),
        { ok: false, reason: "invalid_session" },
      );
      assert.ok(await getSessionFromToken(chairman.accessToken, "chairman"));
    });

    await t.test("disabled accounts cannot start resident sessions", async () => {
      await pool.query(
        "UPDATE users SET status = 'disabled' WHERE id = $1",
        [userId],
      );
      try {
        await assert.rejects(
          createMobileSession(userId, "resident"),
          MobileSignInNotAllowedError,
        );
      } finally {
        await pool.query(
          "UPDATE users SET status = 'active' WHERE id = $1",
          [userId],
        );
      }
    });

    await t.test("platform administrators cannot start resident sessions", async () => {
      await pool.query(
        "INSERT INTO platform_admins (user_id) VALUES ($1)",
        [userId],
      );
      try {
        await assert.rejects(
          createMobileSession(userId, "resident"),
          MobileSignInNotAllowedError,
        );
      } finally {
        await pool.query(
          "DELETE FROM platform_admins WHERE user_id = $1",
          [userId],
        );
      }
    });

    await t.test("created access token authenticates only its portal", async () => {
      const result = await createChairmanMobileSession(userId);
      const session = await getSessionFromToken(
        result.accessToken,
        "chairman",
      );

      assert.equal(result.user.id, userId);
      assert.equal(result.user.portal, "chairman");
      assert.equal(session?.userId, userId);

      assert.equal(
        await getSessionFromToken(result.accessToken, "admin"),
        null,
      );

      assert.equal(
        await getSessionFromToken(result.refreshToken, "chairman"),
        null,
      );
    });

    await t.test("parent revocation immediately blocks access", async () => {
      const result = await createChairmanMobileSession(userId);

      assert.ok(
        await getSessionFromToken(result.accessToken, "chairman"),
      );

      await pool.query(
        `UPDATE mobile_sessions
         SET revoked_at = clock_timestamp(),
             revocation_reason = 'integration_test'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );

      assert.equal(
        await getSessionFromToken(result.accessToken, "chairman"),
        null,
      );
    });

    await t.test("disabled account cannot create a session", async () => {
      await pool.query(
        "UPDATE users SET status = 'disabled' WHERE id = $1",
        [userId],
      );

      const before = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
         FROM mobile_sessions WHERE user_id = $1`,
        [userId],
      );

      try {
        await assert.rejects(
          createChairmanMobileSession(userId),
          MobileSignInNotAllowedError,
        );

        const after = await pool.query<{ count: number }>(
          `SELECT COUNT(*)::integer AS count
           FROM mobile_sessions WHERE user_id = $1`,
          [userId],
        );

        assert.equal(after.rows[0].count, before.rows[0].count);
      } finally {
        await pool.query(
          "UPDATE users SET status = 'active' WHERE id = $1",
          [userId],
        );
      }
    });

    await t.test("platform administrator cannot create a chairman session", async () => {
      await pool.query(
        "INSERT INTO platform_admins (user_id) VALUES ($1)",
        [userId],
      );

      try {
        await assert.rejects(
          createChairmanMobileSession(userId),
          MobileSignInNotAllowedError,
        );
      } finally {
        await pool.query(
          "DELETE FROM platform_admins WHERE user_id = $1",
          [userId],
        );
      }
    });
  } finally {
    try {
      if (fixtureCreated) {
        const client = await pool.connect();

        try {
          await client.query("BEGIN");

          await client.query(
            "DELETE FROM auth_sessions WHERE user_id = $1",
            [userId],
          );

          await client.query(
            `DELETE FROM mobile_refresh_tokens
             WHERE mobile_session_id IN (
               SELECT id FROM mobile_sessions WHERE user_id = $1
             )`,
            [userId],
          );

          await client.query(
            "DELETE FROM mobile_sessions WHERE user_id = $1",
            [userId],
          );

          await client.query(
            "DELETE FROM platform_admins WHERE user_id = $1",
            [userId],
          );

          await client.query(
            "DELETE FROM users WHERE id = $1",
            [userId],
          );

          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.end();
    }
  }
});
