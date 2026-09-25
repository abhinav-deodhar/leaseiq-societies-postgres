import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import { jsonNoStore } from "@/lib/server/http/json";
import { SocietyAccessError } from "@/lib/server/services/society-access.service";
import { getFlatBills } from "@/lib/server/services/flat-billing.service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ societyId: string; unitId: string }> },
): Promise<Response> {
  try {
    const session = await getSessionFromToken(
      readSessionToken(request, "chairman"),
      "chairman",
    );
    if (!session) {
      return jsonNoStore({ message: "Sign in to your chairman account." }, 401);
    }

    const params = z.object({
      societyId: z.uuid(),
      unitId: z.uuid(),
    }).parse(await context.params);

    const page = z.string()
      .regex(/^[1-9][0-9]{0,5}$/)
      .transform(Number)
      .parse(request.nextUrl.searchParams.get("page") ?? "1");
    const status = z.enum(["all", "paid", "outstanding", "overdue"])
      .parse(request.nextUrl.searchParams.get("status") ?? "all");

    const data = await getFlatBills(
      session.userId,
      params.societyId,
      params.unitId,
      page,
      status,
    );

    if (!data) {
      return jsonNoStore({ message: "This flat could not be found." }, 404);
    }

    return jsonNoStore({ ...data, page, pageSize: 20 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore({ message: "Check the flat and billing filters." }, 400);
    }
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ message: error.message }, 403);
    }
    console.error("Flat bill lookup failed.");
    return jsonNoStore({ message: "Unable to load this flat's bills." }, 503);
  }
}
