import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { getDatabase } from "../src/lib/server/db";
import { hashPassword } from "../src/lib/server/auth/password";
import { getSessionFromToken } from "../src/lib/server/auth/session";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as refresh } from "../src/app/api/auth/mobile/refresh/route";

const requireHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireHere("@next/env") as typeof import("@next/env");

test("email-only accounts work across web and Android authentication", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""));
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  Object.assign(process.env, {
    NODE_ENV: "development",
    APP_ORIGIN: "http://localhost:3000",
  });

  const pool = getDatabase();
  const id = randomUUID();
  const phone = `9${randomInt(100_000_000, 1_000_000_000)}`;
  const password = randomBytes(24).toString("hex");
  const request = (path: string, body: unknown) =>
    new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    });
  const signIn = (client = "web", portal = "chairman") =>
    login(request("/api/auth/login", { phone, password, client, portal }));

  let webToken = "";
  let mobileToken = "";
  let refreshToken = "";

  try {
    await pool.query(
      `INSERT INTO users (
        id, full_name, email, phone, date_of_birth, password_hash,
        status, verification_policy
      ) VALUES (
        $1, 'Email Policy Test', $2, $3, '1990-01-01', $4,
        'pending_verification', 'email_only'
      )`,
      [id, `policy-${id}@example.invalid`, `+91${phone}`, await hashPassword(password)],
    );

    await t.test("an unverified email cannot sign in", async () => {
      assert.equal((await signIn()).status, 403);
      assert.equal((await signIn("android")).status, 403);
    });

    await pool.query(
      `UPDATE users SET email_verified_at = clock_timestamp(),
        status = 'active' WHERE id = $1`,
      [id],
    );

    await t.test("web login creates a usable session without phone verification", async () => {
      const response = await signIn();
      assert.equal(response.status, 200);
      webToken = response.headers.get("set-cookie")
        ?.match(/leaseiq_chairman_session=([0-9a-f]{64})/)?.[1] ?? "";
      assert.ok(webToken);
      assert.equal((await getSessionFromToken(webToken, "chairman"))?.userId, id);
      assert.equal(await getSessionFromToken(webToken, "admin"), null);
    });

    await t.test("Android login creates a usable bearer session", async () => {
      const response = await signIn("android");
      assert.equal(response.status, 200);
      const body = await response.json();
      mobileToken = body.accessToken;
      refreshToken = body.refreshToken;
      assert.match(mobileToken, /^[0-9a-f]{64}$/);
      assert.match(refreshToken, /^[0-9a-f]{64}$/);
      assert.equal((await getSessionFromToken(mobileToken, "chairman"))?.userId, id);
    });

    await t.test("Android session renewal works for email-only accounts", async () => {
      const replacement = randomBytes(32).toString("hex");
      const response = await refresh(request("/api/auth/mobile/refresh", {
        refreshToken,
        replacementRefreshToken: replacement,
      }));
      assert.equal(response.status, 200);
      const body = await response.json();
      mobileToken = body.accessToken;
      refreshToken = replacement;
      assert.equal((await getSessionFromToken(mobileToken, "chairman"))?.userId, id);
    });

    await t.test("phone remains unverified and admin login remains denied", async () => {
      const result = await pool.query(
        "SELECT phone_verified_at FROM users WHERE id = $1", [id],
      );
      assert.equal(result.rows[0].phone_verified_at, null);
      assert.equal((await signIn("web", "admin")).status, 403);

      await pool.query("INSERT INTO platform_admins(user_id) VALUES ($1)", [id]);
      try {
        assert.equal((await signIn("web", "admin")).status, 403);
        assert.equal(await getSessionFromToken(webToken, "chairman"), null);
      } finally {
        await pool.query("DELETE FROM platform_admins WHERE user_id = $1", [id]);
      }
    });

    await t.test("disabled accounts lose web and Android access", async () => {
      await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [id]);
      assert.equal(await getSessionFromToken(webToken, "chairman"), null);
      assert.equal(await getSessionFromToken(mobileToken, "chairman"), null);
      assert.equal((await signIn()).status, 403);
      assert.equal((await signIn("android")).status, 403);

      const response = await refresh(request("/api/auth/mobile/refresh", {
        refreshToken,
        replacementRefreshToken: randomBytes(32).toString("hex"),
      }));
      assert.equal(response.status, 403);
    });
  } finally {
    try {
      await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [id]);
      await pool.query(
        `DELETE FROM mobile_refresh_tokens WHERE mobile_session_id IN (
          SELECT id FROM mobile_sessions WHERE user_id = $1
        )`, [id],
      );
      await pool.query("DELETE FROM mobile_sessions WHERE user_id = $1", [id]);
      await pool.query("DELETE FROM platform_admins WHERE user_id = $1", [id]);
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
      const key = createHash("sha256").update(`login:+91${phone}`).digest("hex");
      await pool.query("DELETE FROM login_limits WHERE key_hash = $1", [key]);
    } finally {
      await pool.end();
    }
  }
});
