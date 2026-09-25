import type { NextRequest } from "next/server";
import { societyIdSchema } from "@/lib/contracts/units";
import { unitImportSchema } from "@/lib/contracts/unit-import";
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
import {
  UnitOperationError,
} from "@/lib/server/services/units.service";
import {
  importUnitsForChairman,
} from "@/lib/server/services/unit-import.service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ societyId: string }> },
): Promise<Response> {
  try {
    checkRequestOrigin(request);

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

    const validation = unitImportSchema.safeParse(
      await readJsonBody(request, 512 * 1024),
    );

    if (!validation.success) {
      return jsonNoStore(
        {
          message: "Provide between 1 and 500 valid flat records.",
          errors: validation.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    const result = await importUnitsForChairman(
      session.userId,
      society.data,
      validation.data,
    );

    return jsonNoStore(
      {
        ...result,
        message: !result.valid
          ? "Correct the listed rows before importing. No flats were added."
          : validation.data.mode === "preview"
            ? "Preview passed. The flats are ready to import."
            : `${result.imported} flats imported successfully.`,
      },
      result.valid
        ? validation.data.mode === "import" ? 201 : 200
        : 409,
    );
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore(
        { code: error.code, message: error.message },
        403,
      );
    }

    if (error instanceof UnitOperationError) {
      return jsonNoStore(
        { code: error.code, message: error.message },
        409,
      );
    }

    if (error instanceof HttpError) {
      return jsonNoStore({ message: error.message }, error.status);
    }

    console.error("Unit import request failed.");

    return jsonNoStore(
      {
        message:
          "Unable to confirm the import. Refresh the register before retrying.",
      },
      503,
    );
  }
}
