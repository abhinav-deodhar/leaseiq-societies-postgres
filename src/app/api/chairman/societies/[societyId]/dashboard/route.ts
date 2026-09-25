import type { NextRequest } from "next/server";
import { societyIdSchema } from "@/lib/contracts/units";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import { jsonNoStore } from "@/lib/server/http/json";
import {
  SocietyAccessError,
} from "@/lib/server/services/society-access.service";
import {
  getChairmanDashboard,
} from "@/lib/server/services/chairman-dashboard.service";

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
      return jsonNoStore(
        { message: "Sign in to your chairman account." },
        401,
      );
    }

    const params = await context.params;
    const society = societyIdSchema.safeParse(params.societyId);

    if (!society.success) {
      return jsonNoStore({ message: "Choose a valid society." }, 400);
    }

    return jsonNoStore(
      await getChairmanDashboard(session.userId, society.data),
    );
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore(
        { code: error.code, message: error.message },
        403,
      );
    }

    console.error("Chairman dashboard request failed.");

    return jsonNoStore(
      { message: "Unable to load the dashboard. Please try again." },
      503,
    );
  }
}
