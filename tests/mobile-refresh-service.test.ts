import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getDatabase } from "../src/lib/server/db";
import {
  createMobileTokenPair,
  hashMobileToken,
} from "../src/lib/server/auth/mobile-token";
import { getSessionFromToken } from "../src/lib/server/auth/session";
import {
  createChairmanMobileSession,
} from "../src/lib/server/auth/services/mobile-session-service";
import {
  refreshChairmanMobileSession,
} from "../src/lib/server/auth/services/mobile-refresh-service";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import(
  "@next/env"
);

function nextRefreshToken(): string {
  return createMobileTokenPair().refreshToken;
}

test("mobile refresh service behaviour", async (t) => {
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
         $1, 'Mobile Refresh Test', $2, $3, '1990-01-01',
         'active', clock_timestamp(), clock_timestamp()
       )`,
      [
        userId,
        `mobile-refresh-${userId}@example.invalid`,
        `+919${randomInt(100_000_000, 1_000_000_000)}`,
      ],
    );

    fixtureCreated = true;

    await t.test("rotation works after access expires", async () => {
      const initial = await createChairmanMobileSession(userId);

      await pool.query(
        `UPDATE auth_sessions
         SET created_at = clock_timestamp() - INTERVAL '1 hour',
             expires_at = clock_timestamp() - INTERVAL '1 second'
         WHERE token_hash = $1`,
        [hashMobileToken(initial.accessToken)],
      );

      assert.equal(
        await getSessionFromToken(initial.accessToken, "chairman"),
        null,
      );

      const replacement = nextRefreshToken();
      const result = await refreshChairmanMobileSession(
        initial.refreshToken,
        replacement,
      );

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.session.refreshToken === replacement, true);
      assert.equal(
        (await getSessionFromToken(
          result.session.accessToken,
          "chairman",
        ))?.userId,
        userId,
      );

      const stored = await pool.query<{
        consumed: boolean;
        linked: boolean;
      }>(
        `SELECT
           consumed_at IS NOT NULL AS consumed,
           replacement_token_hash = $2 AS linked
         FROM mobile_refresh_tokens
         WHERE token_hash = $1`,
        [
          hashMobileToken(initial.refreshToken),
          hashMobileToken(replacement),
        ],
      );

      assert.equal(stored.rows[0].consumed, true);
      assert.equal(stored.rows[0].linked, true);
    });

    await t.test("identical retry recovers a lost response", async () => {
      const initial = await createChairmanMobileSession(userId);
      const replacement = nextRefreshToken();

      const first = await refreshChairmanMobileSession(
        initial.refreshToken,
        replacement,
      );

      assert.equal(first.ok, true);

      const retry = await refreshChairmanMobileSession(
        initial.refreshToken,
        replacement,
      );

      assert.equal(retry.ok, true);
      if (!retry.ok) return;

      assert.equal(retry.session.refreshToken === replacement, true);
      assert.ok(
        await getSessionFromToken(
          retry.session.accessToken,
          "chairman",
        ),
      );
    });

    await t.test("simultaneous identical renewals both succeed", async () => {
      const initial = await createChairmanMobileSession(userId);
      const replacement = nextRefreshToken();

      const results = await Promise.all([
        refreshChairmanMobileSession(initial.refreshToken, replacement),
        refreshChairmanMobileSession(initial.refreshToken, replacement),
      ]);

      for (const result of results) {
        assert.equal(result.ok, true);
        if (!result.ok) continue;

        assert.ok(
          await getSessionFromToken(
            result.session.accessToken,
            "chairman",
          ),
        );
      }

      const current = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
         FROM mobile_refresh_tokens
         WHERE mobile_session_id = (
           SELECT mobile_session_id
           FROM mobile_refresh_tokens
           WHERE token_hash = $1
         )
         AND consumed_at IS NULL`,
        [hashMobileToken(initial.refreshToken)],
      );

      assert.equal(current.rows[0].count, 1);
    });

    await t.test("stale identical retry does not revoke newer access", async () => {
      const initial = await createChairmanMobileSession(userId);
      const secondToken = nextRefreshToken();
      const thirdToken = nextRefreshToken();

      const first = await refreshChairmanMobileSession(
        initial.refreshToken,
        secondToken,
      );
      assert.equal(first.ok, true);

      const second = await refreshChairmanMobileSession(
        secondToken,
        thirdToken,
      );
      assert.equal(second.ok, true);

      const stale = await refreshChairmanMobileSession(
        initial.refreshToken,
        secondToken,
      );

      assert.deepEqual(stale, { ok: false, reason: "stale_retry" });

      if (second.ok) {
        assert.ok(
          await getSessionFromToken(
            second.session.accessToken,
            "chairman",
          ),
        );
      }
    });

    await t.test("different replacement on reuse revokes the session", async () => {
      const initial = await createChairmanMobileSession(userId);
      const replacement = nextRefreshToken();

      const first = await refreshChairmanMobileSession(
        initial.refreshToken,
        replacement,
      );
      assert.equal(first.ok, true);

      const reused = await refreshChairmanMobileSession(
        initial.refreshToken,
        nextRefreshToken(),
      );

      assert.deepEqual(reused, { ok: false, reason: "token_reuse" });

      assert.equal(
        await getSessionFromToken(initial.accessToken, "chairman"),
        null,
      );

      if (first.ok) {
        assert.equal(
          await getSessionFromToken(
            first.session.accessToken,
            "chairman",
          ),
          null,
        );
      }

      const furtherRenewal = await refreshChairmanMobileSession(
        replacement,
        nextRefreshToken(),
      );

      assert.deepEqual(furtherRenewal, {
        ok: false,
        reason: "invalid_session",
      });
    });

    await t.test("disabled account renewal revokes its session", async () => {
      const initial = await createChairmanMobileSession(userId);

      await pool.query(
        "UPDATE users SET status = 'disabled' WHERE id = $1",
        [userId],
      );

      try {
        const result = await refreshChairmanMobileSession(
          initial.refreshToken,
          nextRefreshToken(),
        );

        assert.deepEqual(result, {
          ok: false,
          reason: "account_not_allowed",
        });
      } finally {
        await pool.query(
          "UPDATE users SET status = 'active' WHERE id = $1",
          [userId],
        );
      }

      // Restoring the account must not resurrect its revoked session.
      assert.equal(
        await getSessionFromToken(initial.accessToken, "chairman"),
        null,
      );
    });

    await t.test("replacement conflict leaves the original token usable", async () => {
      const first = await createChairmanMobileSession(userId);
      const other = await createChairmanMobileSession(userId);

      const conflict = await refreshChairmanMobileSession(
        first.refreshToken,
        other.refreshToken,
      );

      assert.deepEqual(conflict, {
        ok: false,
        reason: "replacement_conflict",
      });

      const retry = await refreshChairmanMobileSession(
        first.refreshToken,
        nextRefreshToken(),
      );

      assert.equal(retry.ok, true);
      assert.ok(
        await getSessionFromToken(other.accessToken, "chairman"),
      );
    });

    await t.test("malformed and unchanged tokens are rejected", async () => {
      const valid = nextRefreshToken();

      for (const malformed of [null, undefined, "", "invalid", 123]) {
        assert.deepEqual(
          await refreshChairmanMobileSession(malformed, valid),
          { ok: false, reason: "invalid_request" },
        );

        assert.deepEqual(
          await refreshChairmanMobileSession(valid, malformed),
          { ok: false, reason: "invalid_request" },
        );
      }

      assert.deepEqual(
        await refreshChairmanMobileSession(valid, valid),
        { ok: false, reason: "invalid_request" },
      );
    });

    await t.test("unknown token is rejected", async () => {
      assert.deepEqual(
        await refreshChairmanMobileSession(
          nextRefreshToken(),
          nextRefreshToken(),
        ),
        { ok: false, reason: "invalid_session" },
      );
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
