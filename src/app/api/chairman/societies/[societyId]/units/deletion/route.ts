import type { NextRequest } from "next/server";
import { societyIdSchema } from "@/lib/contracts/units";
import { unitDeletionRequestSchema } from "@/lib/contracts/unit-deletion";
import { getSessionFromToken, readSessionToken } from "@/lib/server/auth/session";
import { checkRequestOrigin, HttpError, readJsonBody } from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import { SocietyAccessError } from "@/lib/server/services/society-access.service";
import { manageUnitDeletion, UnitDeletionError } from "@/lib/server/services/unit-deletion.service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ societyId: string }> },
): Promise<Response> {
  try {
    checkRequestOrigin(request);
    const session = await getSessionFromToken(readSessionToken(request, "chairman"), "chairman");
    if (!session) return jsonNoStore({ message: "Please sign in." }, 401);
    const society = societyIdSchema.safeParse((await context.params).societyId);
    const input = unitDeletionRequestSchema.safeParse(await readJsonBody(request, 64 * 1024));
    if (!society.success || !input.success) {
      return jsonNoStore({ message: "Choose valid flats and a valid deletion action." }, 400);
    }
    const result = await manageUnitDeletion(session.userId, society.data, input.data);
    return jsonNoStore(result);
  } catch (error) {
    if (error instanceof SocietyAccessError) return jsonNoStore({ message: error.message }, 403);
    if (error instanceof UnitDeletionError || error instanceof HttpError) {
      return jsonNoStore({ message: error.message }, error.status);
    }
    console.error("Unit deletion request failed.");
    return jsonNoStore({ message: "Unable to confirm deletion. Refresh the register before retrying." }, 503);
  }
}
