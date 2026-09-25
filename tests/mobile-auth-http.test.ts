import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getDatabase } from "../src/lib/server/db";
import { hashPassword } from "../src/lib/server/auth/password";
import {
  createMobileTokenPair,
  isValidMobileToken,
} from "../src/lib/server/auth/mobile-token";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import(
  "@next/env"
);

const baseUrl = "http://localhost:3000";

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
}

async function me(accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/me?portal=chairman`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
}

async function readTokens(response: Response): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("set-cookie"), false);

  const body = await response.json() as Record<string, unknown>;

  // Boolean assertions avoid printing token values on failure.
  assert.equal(isValidMobileToken(body.accessToken), true);
  assert.equal(isValidMobileToken(body.refreshToken), true);
  assert.equal(body.tokenType === "Bearer", true);
  assert.equal(typeof body.expiresAt, "string");
  assert.ok(Number.isFinite(Date.parse(body.expiresAt as string)));

  return {
    accessToken: body.accessToken as string,
    refreshToken: body.refreshToken as string,
  };
}

test("mobile authentication over HTTP", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");

  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(
      process.env.PGHOST ?? "",
    ),
  );
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  const health = await fetch(`${baseUrl}/api/health/database`, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(health.status, 200, "Start the local backend on port 3000.");

  const pool = getDatabase();
  const userId = randomUUID();
  const phone = `9${randomInt(100_000_000, 1_000_000_000)}`;
  const password = `Test-only-${randomUUID()}!`;
  let fixtureCreated = false;

  const loginBody = {
    phone,
    password,
    portal: "chairman",
    client: "android",
  };

  const login = async () => readTokens(
    await post("/api/auth/login", loginBody),
  );

  try {
    await pool.query(
      `INSERT INTO users (
         id, full_name, email, phone, password_hash, date_of_birth,
         status, email_verified_at, phone_verified_at
       )
       VALUES (
         $1, 'HTTP Auth Test', $2, $3, $4, '1990-01-01',
         'active', clock_timestamp(), clock_timestamp()
       )`,
      [
        userId,
        `http-auth-${userId}@example.invalid`,
        `+91${phone}`,
        await hashPassword(password),
      ],
    );
    fixtureCreated = true;

    await t.test("login, renewal, retry and logout work together", async () => {
      const initial = await login();
      assert.equal((await me(initial.accessToken)).status, 200);

      const replacement = createMobileTokenPair().refreshToken;
      const renewalBody = {
        refreshToken: initial.refreshToken,
        replacementRefreshToken: replacement,
      };

      const renewed = await readTokens(
        await post("/api/auth/mobile/refresh", renewalBody),
      );
      assert.equal(renewed.refreshToken === replacement, true);
      assert.equal((await me(renewed.accessToken)).status, 200);

      const retry = await readTokens(
        await post("/api/auth/mobile/refresh", renewalBody),
      );
      assert.equal((await me(retry.accessToken)).status, 200);

      // The old token can log out after a renewal response was lost.
      const logoutBody = { refreshToken: initial.refreshToken };
      assert.equal(
        (await post("/api/auth/mobile/logout", logoutBody)).status,
        200,
      );

      for (const token of [
        initial.accessToken,
        renewed.accessToken,
        retry.accessToken,
      ]) {
        assert.equal((await me(token)).status, 401);
      }

      assert.equal(
        (await post("/api/auth/mobile/refresh", {
          refreshToken: replacement,
          replacementRefreshToken: createMobileTokenPair().refreshToken,
        })).status,
        401,
      );

      assert.equal(
        (await post("/api/auth/mobile/logout", logoutBody)).status,
        200,
      );
    });

    await t.test("web login still uses a cookie and web logout", async () => {
      const response = await post("/api/auth/login", {
        ...loginBody,
        client: "web",
      });

      assert.equal(response.status, 200);

      const body = await response.json() as Record<string, unknown>;
      assert.equal("accessToken" in body, false);
      assert.equal("refreshToken" in body, false);

      const setCookie = response.headers.get("set-cookie");
      assert.ok(setCookie);
      assert.equal(setCookie.includes("leaseiq_chairman_session="), true);
      assert.equal(setCookie.toLowerCase().includes("httponly"), true);
      assert.equal(setCookie.includes("Max-Age=28800"), true);

      const cookie = setCookie.split(";")[0];

      const checked = await fetch(
        `${baseUrl}/api/auth/me?portal=chairman`,
        {
          headers: { Cookie: cookie },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
      assert.equal(checked.status, 200);

      const loggedOut = await fetch(
        `${baseUrl}/api/auth/logout?portal=chairman`,
        {
          method: "POST",
          headers: { Cookie: cookie },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
      assert.equal(loggedOut.status, 200);

      const checkedAgain = await fetch(
        `${baseUrl}/api/auth/me?portal=chairman`,
        {
          headers: { Cookie: cookie },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
      assert.equal(checkedAgain.status, 401);
    });

    await t.test("credentials and account restrictions are enforced", async () => {
      assert.equal(
        (await post("/api/auth/login", {
          ...loginBody,
          password: "Deliberately incorrect password!",
        })).status,
        401,
      );

      assert.equal(
        (await post("/api/auth/login", {
          ...loginBody,
          portal: "admin",
        })).status,
        403,
      );

      await pool.query(
        "UPDATE users SET status = 'disabled' WHERE id = $1",
        [userId],
      );

      try {
        assert.equal(
          (await post("/api/auth/login", loginBody)).status,
          403,
        );
      } finally {
        await pool.query(
          "UPDATE users SET status = 'active' WHERE id = $1",
          [userId],
        );
      }

      await pool.query(
        "INSERT INTO platform_admins (user_id) VALUES ($1)",
        [userId],
      );

      try {
        assert.equal(
          (await post("/api/auth/login", loginBody)).status,
          403,
        );
      } finally {
        await pool.query(
          "DELETE FROM platform_admins WHERE user_id = $1",
          [userId],
        );
      }
    });

    await t.test("logout wins over a simultaneous renewal", async () => {
      const initial = await login();
      const replacement = createMobileTokenPair().refreshToken;

      const [renewal, logout] = await Promise.all([
        post("/api/auth/mobile/refresh", {
          refreshToken: initial.refreshToken,
          replacementRefreshToken: replacement,
        }),
        post("/api/auth/mobile/logout", {
          refreshToken: initial.refreshToken,
        }),
      ]);

      assert.equal(logout.status, 200);
      assert.ok([200, 401].includes(renewal.status));

      if (renewal.status === 200) {
        const tokens = await readTokens(renewal);
        assert.equal((await me(tokens.accessToken)).status, 401);
      }

      assert.equal((await me(initial.accessToken)).status, 401);

      const nextAttempt = await post("/api/auth/mobile/refresh", {
        refreshToken: replacement,
        replacementRefreshToken: createMobileTokenPair().refreshToken,
      });

      assert.equal(nextAttempt.status, 401);
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
          await client.query(
            "DELETE FROM login_limits WHERE key_hash = $1",
            [
              createHash("sha256")
                .update(`login:+91${phone}`)
                .digest("hex"),
            ],
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
