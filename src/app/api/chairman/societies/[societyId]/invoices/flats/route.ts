import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import { jsonNoStore } from "@/lib/server/http/json";
import { SocietyAccessError } from "@/lib/server/services/society-access.service";
import { listFlatBilling } from "@/lib/server/services/flat-billing.service";

const querySchema = z.object({
  page: z.string().regex(/^[1-9][0-9]{0,5}$/).transform(Number),
  search: z.string().trim().max(120).refine(
    value => !/[\u0000-\u001f\u007f]/.test(value),
  ),
  status: z.enum(["all", "paid", "outstanding", "overdue"]),
});

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

    const societyId = z.uuid().parse((await context.params).societyId);
    const query = querySchema.parse({
      page: request.nextUrl.searchParams.get("page") ?? "1",
      search: request.nextUrl.searchParams.get("search") ?? "",
      status: request.nextUrl.searchParams.get("status") ?? "all",
    });

    return jsonNoStore(
      await listFlatBilling(
        session.userId,
        societyId,
        query.page,
        query.search,
        query.status,
      ),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore({ message: "Check the society and billing filters." }, 400);
    }
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ message: error.message }, 403);
    }
    console.error("Flat billing list failed.");
    return jsonNoStore({ message: "Unable to load flat billing." }, 503);
  }
}
