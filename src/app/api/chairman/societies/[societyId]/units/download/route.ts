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
  createUnitWorkbook,
} from "@/lib/server/services/unit-workbook.service";

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
    const kind = request.nextUrl.searchParams.get("kind");

    if (
      !society.success ||
      (kind !== "template" && kind !== "export")
    ) {
      return jsonNoStore(
        { message: "Choose a valid society and download type." },
        400,
      );
    }

    const bytes = await createUnitWorkbook(
      session.userId,
      society.data,
      kind,
    );

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          `attachment; filename="leaseiq-units-${kind}.xlsx"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore(
        { code: error.code, message: error.message },
        403,
      );
    }

    console.error("Unit workbook download failed.");

    return jsonNoStore(
      { message: "Unable to generate the workbook. Please try again." },
      503,
    );
  }
}
