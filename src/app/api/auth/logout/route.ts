import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/server/db";
import {
  hashSessionToken,
  parsePortal,
  readSessionToken,
  sessionCookieName,
} from "@/lib/server/auth/session";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const allowedOrigin = process.env.APP_ORIGIN;

  if (!allowedOrigin) {
    return json({ message: "Logout is not configured." }, 503);
  }

  const origin = request.headers.get("origin");

  if (origin && origin !== allowedOrigin) {
    return json({ message: "Request origin is not permitted." }, 403);
  }

  const portal = parsePortal(request.nextUrl.searchParams.get("portal"));

  if (!portal) {
    return json({ message: "Choose a valid portal." }, 400);
  }

  try {
    const token = readSessionToken(request, portal);

    if (token) {
      await getDatabase().query(
        `UPDATE auth_sessions
         SET revoked_at = clock_timestamp()
         WHERE token_hash = $1
           AND portal = $2
           AND revoked_at IS NULL`,
        [hashSessionToken(token), portal],
      );
    }

    const response = json({ message: "Signed out successfully." }, 200);

    response.cookies.set(sessionCookieName(portal), "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch {
    console.error("Logout failed.");

    return json(
      { message: "Unable to sign out. Please try again." },
      503,
    );
  }
}