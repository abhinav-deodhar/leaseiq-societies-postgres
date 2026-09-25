import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/lib/server/db";
import {
  hashPassword,
  verifyPassword,
} from "@/lib/server/auth/password";
import {
  createMobileSession,
  MobileSignInNotAllowedError,
} from "@/lib/server/auth/services/mobile-session-service";
import {
  JsonRequestError,
  readBoundedJson,
} from "@/lib/server/http/json";

export const runtime = "nodejs";

const SESSION_SECONDS = 8 * 60 * 60;

const loginSchema = z.strictObject({
  phone: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/)
    .transform((value) => `+91${value}`),
  password: z.string().min(1).max(128),
  portal: z.enum(["chairman", "admin", "resident"]),
  client: z.enum(["web", "android"]).default("web"),
});

type LoginUser = {
  id: string;
  full_name: string;
  password_hash: string | null;
  status: string;
  contacts_verified: boolean;
  is_admin: boolean;
};

let dummyHashPromise: Promise<string> | undefined;

function getDummyHash() {
  dummyHashPromise ??= hashPassword(
    randomBytes(32).toString("hex"),
  );

  return dummyHashPromise;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const allowedOrigin = process.env.APP_ORIGIN;

  if (!allowedOrigin) {
    return json({ message: "Login is not configured." }, 503);
  }

  const origin = request.headers.get("origin");

  if (origin !== null && origin !== allowedOrigin) {
    return json(
      { message: "Request origin is not permitted." },
      403,
    );
  }

  let body: unknown;

  try {
    body = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof JsonRequestError) {
      return json({ message: error.message }, error.status);
    }

    return json({ message: "Unable to read login request." }, 400);
  }

  const validation = loginSchema.safeParse(body);

  if (!validation.success) {
    return json(
      {
        message:
          "Enter a 10-digit mobile number, password, and valid portal.",
      },
      400,
    );
  }

  const { phone, password, portal, client } = validation.data;

  if (client === "android" && portal === "admin") {
    return json(
      {
        message:
          "Use the web portal for platform administrator sign-in.",
      },
      403,
    );
  }

  try {
    const database = getDatabase();

    // Share the existing limit across portals and client types.
    const limit = await database.query<{
      attempts: number;
      retry_after: number;
    }>(
      `INSERT INTO login_limits AS current_limit (
         key_hash, attempts, expires_at
       )
       VALUES (
         $1, 1, clock_timestamp() + INTERVAL '15 minutes'
       )
       ON CONFLICT (key_hash) DO UPDATE
       SET attempts = CASE
             WHEN current_limit.expires_at <= clock_timestamp()
             THEN 1
             ELSE LEAST(current_limit.attempts + 1, 11)
           END,
           expires_at = CASE
             WHEN current_limit.expires_at <= clock_timestamp()
             THEN clock_timestamp() + INTERVAL '15 minutes'
             ELSE current_limit.expires_at
           END
       RETURNING attempts,
         GREATEST(
           1,
           CEIL(EXTRACT(EPOCH FROM (
             expires_at - clock_timestamp()
           )))::INTEGER
         ) AS retry_after`,
      [sha256(`login:${phone}`)],
    );

    if (limit.rows[0].attempts > 10) {
      const response = json(
        {
          message:
            "Too many login attempts. Please try again later.",
        },
        429,
      );

      response.headers.set(
        "Retry-After",
        String(limit.rows[0].retry_after),
      );

      return response;
    }

    const dummyHash = await getDummyHash();

    const result = await database.query<LoginUser>(
      `SELECT
         u.id,
         u.full_name,
         u.password_hash,
         u.status,
         (
           u.email_verified_at IS NOT NULL
           AND u.phone_verified_at IS NOT NULL
         ) AS contacts_verified,
         EXISTS (
           SELECT 1
           FROM platform_admins a
           WHERE a.user_id = u.id
         ) AS is_admin
       FROM users u
       WHERE u.phone = $1`,
      [phone],
    );

    const user = result.rows[0];

    const passwordMatches = await verifyPassword(
      password,
      user?.password_hash ?? dummyHash,
    );

    if (!user || !user.password_hash || !passwordMatches) {
      return json(
        { message: "Invalid mobile number or password." },
        401,
      );
    }

    if (user.status !== "active" || !user.contacts_verified) {
      return json(
        {
          message:
            "This account cannot sign in. Complete verification or contact support.",
        },
        403,
      );
    }

    if (portal === "admin" && !user.is_admin) {
      return json({ message: "You do not have admin access." }, 403);
    }

    if (portal !== "admin" && user.is_admin) {
      return json(
        {
          message:
            "This is a platform administrator account. Use Admin sign in.",
        },
        403,
      );
    }

    if (client === "android") {
      const mobileSession = await createMobileSession(
        user.id,
        portal === "resident" ? "resident" : "chairman",
      );

      return json(
        {
          message: "Signed in successfully.",
          ...mobileSession,
        },
        200,
      );
    }

    const token = randomBytes(32).toString("hex");

    const session = await database.query<{ expires_at: Date }>(
      `INSERT INTO auth_sessions (
         user_id, token_hash, portal, expires_at
       )
       VALUES (
         $1, $2, $3, clock_timestamp() + INTERVAL '8 hours'
       )
       RETURNING expires_at`,
      [user.id, sha256(token), portal],
    );

    const response = json(
      {
        message: "Signed in successfully.",
        user: {
          id: user.id,
          fullName: user.full_name,
          portal,
        },
        expiresAt: session.rows[0].expires_at.toISOString(),
      },
      200,
    );

    response.cookies.set(`leaseiq_${portal}_session`, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_SECONDS,
    });

    return response;
  } catch (error) {
    if (error instanceof MobileSignInNotAllowedError) {
      return json(
        { message: "This account cannot sign in to the app." },
        403,
      );
    }

    console.error("Login failed.");

    return json(
      { message: "Unable to sign in right now. Please try again." },
      500,
    );
  }
}
