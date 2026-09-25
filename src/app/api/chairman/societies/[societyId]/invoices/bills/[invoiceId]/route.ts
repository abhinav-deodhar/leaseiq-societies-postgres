import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import { jsonNoStore } from "@/lib/server/http/json";
import { SocietyAccessError } from "@/lib/server/services/society-access.service";
import { getIssuedBillDetail } from "@/lib/server/services/issued-bill-detail.service";

export const runtime = "nodejs";

const paramsSchema = z.object({
  societyId: z.uuid(),
  invoiceId: z.uuid(),
});
const pageSchema = z.string()
  .regex(/^[1-9][0-9]{0,5}$/)
  .transform(Number);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ societyId: string; invoiceId: string }> },
): Promise<Response> {
  try {
    const session = await getSessionFromToken(
      readSessionToken(request, "chairman"),
      "chairman",
    );
    if (!session) {
      return jsonNoStore({ message: "Sign in to your chairman account." }, 401);
    }

    const params = paramsSchema.safeParse(await context.params);
    const page = pageSchema.safeParse(
      request.nextUrl.searchParams.get("receiptPage") ?? "1",
    );
    if (!params.success || !page.success) {
      return jsonNoStore({ message: "Choose a valid invoice and receipt page." }, 400);
    }

    const detail = await getIssuedBillDetail(
      session.userId,
      params.data.societyId,
      params.data.invoiceId,
      page.data,
    );
    if (!detail) {
      return jsonNoStore({ message: "This invoice could not be found." }, 404);
    }
    return jsonNoStore(detail);
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ message: error.message }, 403);
    }
    console.error("Issued invoice detail lookup failed.");
    return jsonNoStore({ message: "Unable to load this invoice." }, 503);
  }
}
