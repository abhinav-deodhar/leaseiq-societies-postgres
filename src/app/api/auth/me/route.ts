import type { NextRequest } from "next/server";
import {
  getSessionFromToken,
  parsePortal,
  readSessionToken,
} from "@/lib/server/auth/session";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const portal = parsePortal(request.nextUrl.searchParams.get("portal"));

  if (!portal) {
    return json({ message: "Choose a valid portal." }, 400);
  }

  try {
    const session = await getSessionFromToken(
      readSessionToken(request, portal),
      portal,
    );

    if (!session) {
      return json({ message: "Please sign in." }, 401);
    }

    return json(
      {
        user: {
          id: session.userId,
          fullName: session.fullName,
          portal: session.portal,
        },
        expiresAt: session.expiresAt.toISOString(),
      },
      200,
    );
  } catch {
    console.error("Session lookup failed.");

    return json(
      { message: "Unable to check your session. Please try again." },
      503,
    );
  }
}