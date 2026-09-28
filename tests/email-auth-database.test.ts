import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { getDatabase } from "../src/lib/server/db";
import { HttpError } from "../src/lib/server/http";
import { hashPassword, verifyPassword } from "../src/lib/server/auth/password";
import {
  requestEmailCode,
  verifyEmailCode,
  resetEmailPassword,
} from "../src/lib/server/auth/email-auth-service";

const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as
  typeof import("@next/env");

const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.status === code;

test("email authentication database flows", async t => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""));
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  const previousSecret = process.env.OTP_HASH_SECRET;
  if (!previousSecret) process.env.OTP_HASH_SECRET = randomBytes(32).toString("hex");
  const secret = process.env.OTP_HASH_SECRET!;
  assert.match(secret, /^[0-9a-f]{64}$/i);

  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const emails = ids.map(id => `email-auth-${id}@example.invalid`);
  const unknownEmail = `email-auth-${randomUUID()}@example.invalid`;
  const keys = [...emails, unknownEmail].flatMap(email =>
    ["request", "verify"].map(scope =>
      createHmac("sha256", Buffer.from(secret, "hex"))
        .update(JSON.stringify(["leaseiq-email-auth-v1", scope, email]))
        .digest("hex"),
    ),
  );
  const oldPassword = "Original-password!2026";
  const newPassword = "Replacement-password!2026";
  const db = getDatabase();
  const sent: Array<{ destination: string; code: string }> = [];
  const send = async (input: { destination: string; code: string }) => {
    sent.push(input);
  };
  const codeFor = (email: string) => {
    const message = sent.find(item => item.destination === email);
    assert.ok(message);
    return message.code;
  };

  try {
    const passwordHash = await hashPassword(oldPassword);
    for (let index = 0; index < ids.length; index++) {
      await db.query(
        `INSERT INTO users (
           id, full_name, email, phone, password_hash,
           status, email_verified_at, verification_policy
         ) VALUES ($1,'Email Auth Test',$2,$3,$4,'active',now(),'email_only')`,
        [
          ids[index], emails[index],
          `+919${randomInt(100000000, 1000000000)}`, passwordHash,
        ],
      );
    }

    await t.test("unknown email has a normal request shape but receives no email", async () => {
      const request = await requestEmailCode({
        email: unknownEmail, portal: "resident", purpose: "login",
      }, send);
      assert.ok(request.challengeId);
      await request.deliver();
      assert.equal(sent.length, 0);
      await assert.rejects(verifyEmailCode({
        challengeId: request.challengeId,
        portal: "resident", purpose: "login", code: "123456",
      }), status(400));
    });

    await t.test("login code is portal-bound, purpose-bound and single-use", async () => {
      const request = await requestEmailCode({
        email: emails[0], portal: "resident", purpose: "login",
      }, send);
      assert.equal(sent.length, 0);
      await request.deliver();
      await request.deliver();
      assert.equal(sent.length, 1);

      await assert.rejects(requestEmailCode({
        email: emails[0], portal: "chairman", purpose: "reset_password",
      }, send), status(429));

      const input = {
        challengeId: request.challengeId,
        portal: "resident", purpose: "login", code: codeFor(emails[0]),
      };
      await assert.rejects(
        verifyEmailCode({ ...input, portal: "chairman" }), status(400),
      );
      await assert.rejects(
        verifyEmailCode({ ...input, purpose: "reset_password" }), status(400),
      );

      const outcomes = await Promise.allSettled([
        verifyEmailCode(input), verifyEmailCode(input),
      ]);
      assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter(item => item.status === "rejected").length, 1);
      const success = outcomes.find(item => item.status === "fulfilled");
      assert.ok(success && success.status === "fulfilled");
      assert.equal(success.value.kind, "login");
      await assert.rejects(verifyEmailCode(input), status(400));

      const sessions = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM auth_sessions WHERE user_id=$1",
        [ids[0]],
      );
      assert.equal(sessions.rows[0].count, 1);
    });

    await t.test("reset revokes browser and mobile sessions and cannot be replayed", async () => {
      const mobile = await db.query<{ id: string }>(
        "INSERT INTO mobile_sessions(user_id,portal) VALUES ($1,'chairman') RETURNING id",
        [ids[1]],
      );
      const mobileId = mobile.rows[0].id;
      await db.query(
        "INSERT INTO mobile_refresh_tokens(token_hash,mobile_session_id) VALUES ($1,$2)",
        [randomBytes(32).toString("hex"), mobileId],
      );
      for (const parent of [null, mobileId]) {
        await db.query(
          `INSERT INTO auth_sessions(
             user_id, token_hash, portal, expires_at, mobile_session_id
           ) VALUES ($1,$2,'chairman',clock_timestamp()+interval '1 hour',$3)`,
          [ids[1], randomBytes(32).toString("hex"), parent],
        );
      }

      const request = await requestEmailCode({
        email: emails[1], portal: "chairman", purpose: "reset_password",
      }, send);
      await request.deliver();
      const verified = await verifyEmailCode({
        challengeId: request.challengeId,
        portal: "chairman", purpose: "reset_password", code: codeFor(emails[1]),
      });
      assert.equal(verified.kind, "reset_password");
      if (verified.kind !== "reset_password") throw new Error("Expected reset grant");

      const input = {
        portal: "chairman",
        resetToken: verified.resetToken,
        newPassword,
        confirmPassword: newPassword,
      };
      await assert.rejects(
        resetEmailPassword({ ...input, portal: "resident" }), status(400),
      );
      await assert.rejects(
        resetEmailPassword({ ...input, confirmPassword: "different" }), status(400),
      );

      await resetEmailPassword(input);
      await assert.rejects(resetEmailPassword(input), status(400));

      const account = await db.query<{ hash: string; revision: number }>(
        `SELECT password_hash AS hash, credential_revision AS revision
         FROM users WHERE id=$1`,
        [ids[1]],
      );
      assert.equal(account.rows[0].revision, 1);
      assert.equal(await verifyPassword(newPassword, account.rows[0].hash), true);
      assert.equal(await verifyPassword(oldPassword, account.rows[0].hash), false);

      const sessions = await db.query<{ active: number }>(
        `SELECT count(*)::int AS active FROM auth_sessions
         WHERE user_id=$1 AND revoked_at IS NULL`,
        [ids[1]],
      );
      assert.equal(sessions.rows[0].active, 0);

      const families = await db.query<{ revoked: boolean; reason: string }>(
        `SELECT revoked_at IS NOT NULL AS revoked, revocation_reason AS reason
         FROM mobile_sessions WHERE id=$1`,
        [mobileId],
      );
      assert.equal(families.rows[0].revoked, true);
      assert.equal(families.rows[0].reason, "password_reset");

      const grant = await db.query<{ consumed: boolean }>(
        `SELECT consumed_at IS NOT NULL AS consumed
         FROM email_password_reset_grants WHERE token_hash=$1`,
        [createHash("sha256").update(verified.resetToken).digest("hex")],
      );
      assert.equal(grant.rows[0].consumed, true);
    });

    await t.test("five wrong codes remain counted and exhaust the challenge", async () => {
      const request = await requestEmailCode({
        email: emails[2], portal: "resident", purpose: "login",
      }, send);
      await request.deliver();
      const code = codeFor(emails[2]);
      const input = {
        challengeId: request.challengeId,
        portal: "resident", purpose: "login",
        code: code === "000000" ? "111111" : "000000",
      };
      for (let attempt = 0; attempt < 5; attempt++) {
        await assert.rejects(verifyEmailCode(input), status(400));
      }
      await assert.rejects(verifyEmailCode({ ...input, code }), status(400));

      const challenge = await db.query<{ attempts: number }>(
        "SELECT attempts FROM email_auth_challenges WHERE id=$1",
        [request.challengeId],
      );
      assert.equal(challenge.rows[0].attempts, 5);
    });

    await t.test("successful login and reset produce audit events", async () => {
      const events = await db.query<{ event_type: string }>(
        `SELECT event_type FROM email_auth_events
         WHERE user_id=ANY($1::uuid[]) ORDER BY event_type`,
        [ids],
      );
      assert.deepEqual(
        events.rows.map(row => row.event_type),
        ["email_login", "password_reset"],
      );
    });
  } finally {
    try {
      await db.query("DELETE FROM email_auth_events WHERE user_id=ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM email_password_reset_grants WHERE user_id=ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM email_auth_challenges WHERE user_id=ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])", [ids]);
      await db.query(
        `DELETE FROM mobile_refresh_tokens WHERE mobile_session_id IN (
           SELECT id FROM mobile_sessions WHERE user_id=ANY($1::uuid[])
         )`, [ids],
      );
      await db.query("DELETE FROM mobile_sessions WHERE user_id=ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM email_auth_limits WHERE key_hash=ANY($1::text[])", [keys]);
    } finally {
      await db.end();
      if (previousSecret === undefined) delete process.env.OTP_HASH_SECRET;
      else process.env.OTP_HASH_SECRET = previousSecret;
    }
  }
});
