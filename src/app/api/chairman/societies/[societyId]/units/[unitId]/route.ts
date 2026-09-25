import type { NextRequest } from "next/server";
import { z } from "zod";
import { updateUnitSchema } from "@/lib/contracts/unit-update";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import {
  checkRequestOrigin,
  HttpError,
  readJsonBody,
} from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import {
  SocietyAccessError,
} from "@/lib/server/services/society-access.service";
import { UnitOperationError } from "@/lib/server/services/units.service";
import {
  UnitUpdateError,
  updateUnitForChairman,
} from "@/lib/server/services/unit-update.service";

export const runtime = "nodejs";

const paramsSchema = z.strictObject({
  societyId: z.uuid(),
  unitId: z.uuid(),
});

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{ societyId: string; unitId: string }>;
  },
): Promise<Response> {
  try {
    checkRequestOrigin(request);

    const session = await getSessionFromToken(
      readSessionToken(request, "chairman"),
      "chairman",
    );

    if (!session) {
      return jsonNoStore({ message: "Please sign in." }, 401);
    }

    const params = paramsSchema.safeParse(await context.params);
    const body = updateUnitSchema.safeParse(
      await readJsonBody(request, 4096),
    );

    if (!params.success || !body.success) {
      return jsonNoStore(
        { message: "Send valid flat details and its current revision." },
        400,
      );
    }

    const unit = await updateUnitForChairman(
      session.userId,
      params.data.societyId,
      params.data.unitId,
      body.data,
    );

    return jsonNoStore({ message: "Flat updated successfully.", unit });
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ code: error.code, message: error.message }, 403);
    }

    if (error instanceof UnitUpdateError) {
      return jsonNoStore(
        { code: error.code, message: error.message },
        error.code === "NOT_FOUND" ? 404 : 409,
      );
    }

    if (error instanceof UnitOperationError) {
      return jsonNoStore(
        { code: error.code, message: error.message },
        error.code === "INVALID_UNIT_TYPE" ? 400 : 409,
      );
    }

    if (error instanceof HttpError) {
      return jsonNoStore({ message: error.message }, error.status);
    }

    console.error("Unit update failed.");
    return jsonNoStore(
      { message: "Unable to update the flat. Please try again." },
      503,
    );
  }
}
