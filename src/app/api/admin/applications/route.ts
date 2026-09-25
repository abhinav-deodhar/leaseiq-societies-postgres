import type { NextRequest } from "next/server";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import { applicationListQuerySchema } from "@/lib/contracts/application-list";
import { listApplicationsForAdmin } from "@/lib/server/services/application-list.service";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromToken(
      readSessionToken(request, "admin"),
      "admin",
    );

    if (!session) {
      return json({ message: "Sign in to your admin account." }, 401);
    }

    const validation = applicationListQuerySchema.safeParse({
      status: request.nextUrl.searchParams.get("status") ?? "all",
      page: request.nextUrl.searchParams.get("page") ?? "1",
    });

    if (!validation.success) {
      return json({ message: "Invalid status filter or page number." }, 400);
    }

    const result = await listApplicationsForAdmin(
      session.userId,
      validation.data,
    );

    return json(result, 200);
  } catch {
    console.error("Admin application list failed.");

    return json(
      { message: "Unable to load applications. Please try again." },
      500,
    );
  }
}