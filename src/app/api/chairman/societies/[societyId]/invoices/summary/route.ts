import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import { jsonNoStore } from "@/lib/server/http/json";
import { SocietyAccessError } from "@/lib/server/services/society-access.service";
import { getBillingSummary } from "@/lib/server/services/billing-summary.service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ societyId: string }> },
): Promise<Response> {
  try {
    const session = await getSessionFromToken(
      readSessionToken(request, "chairman"),
      "chairman",
    );
    if (!session) {
      return jsonNoStore({ message: "Sign in to your chairman account." }, 401);
    }

    const societyId = z.uuid().safeParse((await context.params).societyId);
    if (!societyId.success) {
      return jsonNoStore({ message: "Choose a valid society." }, 400);
    }

    return jsonNoStore(
      await getBillingSummary(session.userId, societyId.data),
    );
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ message: error.message }, 403);
    }
    console.error("Billing summary lookup failed.");
    return jsonNoStore({ message: "Unable to load billing totals." }, 503);
  }
}
