import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { getDatabase } from "../src/lib/server/db";
import { hashPassword } from "../src/lib/server/auth/password";
import {
  createPasswordSession, PasswordSessionRejectedError,
} from "../src/lib/server/auth/password-session";
import { lockMobileSessionForRefresh } from "../src/lib/server/auth/repositories/mobile-refresh-repository";

const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as
  typeof import("@next/env");

test("password sessions recheck credentials and refresh locks the account first", async t => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""));
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  const db = getDatabase();
  const userId = randomUUID();
  const oldHash = await hashPassword("Original-password!2026");
  const newHash = await hashPassword("Replacement-password!2026");
  try {
    await db.query(
      `INSERT INTO users (
         id, full_name, email, phone, password_hash,
         status, email_verified_at, verification_policy
       ) VALUES ($1,'Session Test',$2,$3,$4,'active',now(),'email_only')`,
      [
        userId, `session-${userId}@example.invalid`,
        `+919${randomInt(100000000, 1000000000)}`, oldHash,
      ],
    );

    await t.test("unchanged credentials can create web and Android sessions", async () => {
      const web = await createPasswordSession({
        userId, expectedPasswordHash: oldHash,
        portal: "resident", client: "web",
      });
      assert.equal(web.client, "web");
      const mobile = await createPasswordSession({
        userId, expectedPasswordHash: oldHash,
        portal: "chairman", client: "android",
      });
      assert.equal(mobile.client, "android");
    });

    await t.test("credentials verified before a password change cannot create sessions", async () => {
      await db.query(
        `UPDATE users SET password_hash=$2,
           credential_revision=credential_revision+1 WHERE id=$1`,
        [userId, newHash],
      );

      for (const client of ["web", "android"] as const) {
        await assert.rejects(createPasswordSession({
          userId, expectedPasswordHash: oldHash, portal: "resident", client,
        }), PasswordSessionRejectedError);
      }
      const sessions = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM auth_sessions WHERE user_id=$1",
        [userId],
      );
      assert.equal(sessions.rows[0].count, 2);
    });

    await t.test("refresh lookup respects the revised locking sequence", async () => {
      const mobile = await db.query<{ id: string }>(
        "SELECT id FROM mobile_sessions WHERE user_id=$1",
        [userId],
      );
      const hash = randomBytes(32).toString("hex");
      // Reuse the existing current token row, isolated to this fixture.
      await db.query(
        `UPDATE mobile_refresh_tokens SET token_hash=$2
         WHERE mobile_session_id=$1 AND consumed_at IS NULL`,
        [mobile.rows[0].id, hash],
      );
      const connection = await db.connect();
      try {
        await connection.query("BEGIN");
        const session = await lockMobileSessionForRefresh(connection, hash);
        assert.equal(session?.userId, userId);
        assert.equal(session?.eligible, true);
        await connection.query("ROLLBACK");
      } finally {
        connection.release();
      }
    });

    await t.test("disabled accounts cannot create sessions with current credentials", async () => {
      await db.query("UPDATE users SET status='disabled' WHERE id=$1", [userId]);
      await assert.rejects(createPasswordSession({
        userId, expectedPasswordHash: newHash,
        portal: "resident", client: "web",
      }), PasswordSessionRejectedError);
    });
  } finally {
    try {
      await db.query("DELETE FROM auth_sessions WHERE user_id=$1", [userId]);
      await db.query(
        `DELETE FROM mobile_refresh_tokens WHERE mobile_session_id IN (
           SELECT id FROM mobile_sessions WHERE user_id=$1
         )`, [userId],
      );
      await db.query("DELETE FROM mobile_sessions WHERE user_id=$1", [userId]);
      await db.query("DELETE FROM users WHERE id=$1", [userId]);
    } finally {
      await db.end();
    }
  }
});
