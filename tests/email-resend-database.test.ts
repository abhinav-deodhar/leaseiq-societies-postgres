import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { getDatabase } from "../src/lib/server/db";
import {
  resendRegistrationEmail,
  EmailResendError,
} from "../src/lib/server/auth/email-resend";
import {
  createVerificationCode,
  matchesVerificationCode,
} from "../src/lib/server/auth/verification-code";
import { POST as resendRoute } from "../src/app/api/auth/verify/resend-email/route";
import { POST as verifyRoute } from "../src/app/api/auth/verify/route";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import("@next/env");
const rejectsWith = (status: number) => (error: unknown) =>
  error instanceof EmailResendError && error.status === status;

test("email resend database behaviour", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""));
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  Object.assign(process.env, {
    NODE_ENV: "development",
    VERIFICATION_DELIVERY: "console",
    OTP_HASH_SECRET: randomBytes(32).toString("hex"),
    APP_ORIGIN: "http://localhost:3000",
  });

  const pool = getDatabase();
  const userIds: string[] = [];
  const fakeSend = async () => "accepted" as const;

  async function seed(age = 120, purpose = "verify_email") {
    const userId = randomUUID();
    const email = `resend-${userId}@example.invalid`;
    const phone = `+919${randomInt(100_000_000, 1_000_000_000)}`;

    await pool.query(
      `INSERT INTO users (id, full_name, email, phone, date_of_birth)
       VALUES ($1, 'Resend Test', $2, $3, '1990-01-01')`,
      [userId, email, phone],
    );
    userIds.push(userId);
    const challenge = createVerificationCode();

    await pool.query(
      `INSERT INTO verification_challenges
       (id, user_id, purpose, channel, destination, code_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6,
         clock_timestamp() - $7 * interval '1 second',
         clock_timestamp() - $7 * interval '1 second' + interval '10 minutes')`,
      [
        challenge.id, userId, purpose,
        purpose === "verify_email" ? "email" : "sms",
        purpose === "verify_email" ? email : phone,
        challenge.codeHash, age,
      ],
    );
    return { userId, email, challenge };
  }

  const request = (path: string, body: unknown, origin = "http://localhost:3000") =>
    new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    });

  try {
    await t.test("replacement invalidates the old code and verifies email only", async () => {
      const fixture = await seed();
      let sent: ReturnType<typeof createVerificationCode> | undefined;

      const result = await resendRegistrationEmail(
        { challengeId: fixture.challenge.id },
        async (to, code) => {
          assert.equal(to, fixture.email);
          sent = code;
          return "accepted";
        },
      );
      assert.ok(sent);
      const rows = await pool.query(
        "SELECT * FROM verification_challenges WHERE user_id = $1 ORDER BY created_at",
        [fixture.userId],
      );
      assert.equal(rows.rows.length, 2);
      assert.ok(rows.rows[0].invalidated_at);
      assert.equal(rows.rows[1].invalidated_at, null);
      assert.ok(matchesVerificationCode(sent.id, sent.code, rows.rows[1].code_hash));
      assert.equal(JSON.stringify(result).includes('"code":'), false);

      const oldResponse = await verifyRoute(request("/api/auth/verify", {
        challengeId: fixture.challenge.id, code: fixture.challenge.code,
      }));
      assert.equal(oldResponse.status, 409);

      const response = await verifyRoute(request("/api/auth/verify", {
        challengeId: sent.id, code: sent.code,
      }));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.emailVerified, true);
      assert.equal(body.phoneVerified, false);
      assert.equal(body.status, "pending_verification");
    });

    await t.test("cooldown returns Retry-After without creating another code", async () => {
      const fixture = await seed(0);
      const response = await resendRoute(request("/api/auth/verify/resend-email", {
        challengeId: fixture.challenge.id,
      }));
      assert.equal(response.status, 429);
      const retry = Number(response.headers.get("Retry-After"));
      assert.ok(retry > 0 && retry <= 60);
      const rows = await pool.query(
        "SELECT id FROM verification_challenges WHERE user_id = $1", [fixture.userId],
      );
      assert.equal(rows.rows.length, 1);
    });

    await t.test("hourly limit includes invalidated challenges", async () => {
      const fixture = await seed(300);
      for (let i = 0; i < 4; i++) {
        await pool.query(
          `INSERT INTO verification_challenges
           (id, user_id, purpose, channel, destination, code_hash,
            created_at, expires_at, invalidated_at)
           SELECT $1, user_id, purpose, channel, destination, code_hash,
                  created_at, expires_at, clock_timestamp()
           FROM verification_challenges WHERE id = $2`,
          [randomUUID(), fixture.challenge.id],
        );
      }
      await assert.rejects(
        resendRegistrationEmail({ challengeId: fixture.challenge.id }, fakeSend),
        rejectsWith(429),
      );
    });

    await t.test("concurrent requests deliver only one replacement", async () => {
      const fixture = await seed();
      let calls = 0;
      const send = async () => { calls++; return "accepted" as const; };
      const results = await Promise.allSettled([
        resendRegistrationEmail({ challengeId: fixture.challenge.id }, send),
        resendRegistrationEmail({ challengeId: fixture.challenge.id }, send),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(calls, 1);
      const rejected = results.find((r) => r.status === "rejected");
      assert.ok(rejected?.status === "rejected" && rejectsWith(429)(rejected.reason));
    });

    await t.test("failed delivery retains the new handle and enforces cooldown", async () => {
      const fixture = await seed();
      const result = await resendRegistrationEmail(
        { challengeId: fixture.challenge.id },
        async () => { throw new Error("Simulated provider failure"); },
      );
      assert.equal(result.delivery.email, "unconfirmed");
      assert.ok(result.verification.email.challengeId);
      await assert.rejects(
        resendRegistrationEmail({ challengeId: fixture.challenge.id }, fakeSend),
        rejectsWith(429),
      );

      // Simulate the client losing the response and retrying after cooldown.
      await pool.query(
        `UPDATE verification_challenges
         SET created_at = clock_timestamp() - interval '61 seconds' WHERE id = $1`,
        [result.verification.email.challengeId],
      );
      const retry = await resendRegistrationEmail(
        { challengeId: fixture.challenge.id }, fakeSend,
      );
      assert.notEqual(
        retry.verification.email.challengeId,
        result.verification.email.challengeId,
      );
      const users = await pool.query(
        "SELECT id FROM users WHERE email = $1", [fixture.email],
      );
      assert.equal(users.rows.length, 1);
    });

    await t.test("verified, disabled and changed-contact accounts are blocked", async () => {
      for (const state of ["verified", "disabled", "changed"]) {
        const fixture = await seed();
        if (state === "verified") {
          await pool.query(
            "UPDATE users SET email_verified_at = clock_timestamp() WHERE id = $1",
            [fixture.userId],
          );
        } else if (state === "disabled") {
          await pool.query(
            "UPDATE users SET status = 'disabled' WHERE id = $1", [fixture.userId],
          );
        } else {
          await pool.query(
            "UPDATE users SET email = $2 WHERE id = $1",
            [fixture.userId, `changed-${fixture.userId}@example.invalid`],
          );
        }
        await assert.rejects(
          resendRegistrationEmail({ challengeId: fixture.challenge.id }, fakeSend),
          rejectsWith(409),
        );
      }
    });

    await t.test("expired codes can be replaced but stale and phone handles cannot", async () => {
      const expired = await seed(700);
      assert.equal(
        (await resendRegistrationEmail(
          { challengeId: expired.challenge.id }, fakeSend,
        )).delivery.email,
        "accepted",
      );
      const stale = await seed(90_000);
      await assert.rejects(
        resendRegistrationEmail({ challengeId: stale.challenge.id }, fakeSend),
        rejectsWith(409),
      );
      const phone = await seed(120, "verify_phone");
      await assert.rejects(
        resendRegistrationEmail({ challengeId: phone.challenge.id }, fakeSend),
        rejectsWith(404),
      );
    });

    await t.test("invalid input and foreign origins are rejected", async () => {
      await assert.rejects(
        resendRegistrationEmail({ challengeId: "invalid" }, fakeSend),
        rejectsWith(400),
      );
      await assert.rejects(
        resendRegistrationEmail({ challengeId: randomUUID() }, fakeSend),
        rejectsWith(404),
      );
      const fixture = await seed();
      assert.equal((await resendRoute(request(
        "/api/auth/verify/resend-email",
        { challengeId: fixture.challenge.id },
        "https://other.example",
      ))).status, 403);
      assert.equal((await resendRoute(request(
        "/api/auth/verify/resend-email",
        { challengeId: fixture.challenge.id, email: "other@example.com" },
      ))).status, 400);
    });
  } finally {
    try {
      await pool.query(
        "DELETE FROM verification_challenges WHERE user_id = ANY($1::uuid[])",
        [userIds],
      );
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
    } finally {
      await pool.end();
    }
  }
});
