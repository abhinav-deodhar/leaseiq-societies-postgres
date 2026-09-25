import type { NextRequest } from "next/server";
import {
  createUnitSchema,
  societyIdSchema,
  unitListQuerySchema,
} from "@/lib/contracts/units";
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
  createUnitForChairman,
  listUnitsForChairman,
  UnitOperationError,
} from "@/lib/server/services/units.service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ societyId: string }>;
};

function handleError(error: unknown): Response {
  if (error instanceof SocietyAccessError) {
    return jsonNoStore(
      { code: error.code, message: error.message },
      403,
    );
  }

  if (error instanceof UnitOperationError) {
    return jsonNoStore(
      { code: error.code, message: error.message },
      error.code === "DUPLICATE_UNIT" ? 409 : 400,
    );
  }

  if (error instanceof HttpError) {
    return jsonNoStore({ message: error.message }, error.status);
  }

  console.error("Unit management request failed.");

  return jsonNoStore(
    { message: "Unable to complete this request. Please try again." },
    503,
  );
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
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

    const query = unitListQuerySchema.safeParse({
      page: request.nextUrl.searchParams.get("page") ?? "1",
      search: request.nextUrl.searchParams.get("search") ?? "",
    });

    if (!society.success || !query.success) {
      return jsonNoStore(
        { message: "Choose a valid society, page, and search." },
        400,
      );
    }

    return jsonNoStore(
      await listUnitsForChairman(
        session.userId,
        society.data,
        query.data,
      ),
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
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

    const validation = createUnitSchema.safeParse(
      await readJsonBody(request, 4096),
    );

    if (!validation.success) {
      return jsonNoStore(
        {
          message: "Please correct the unit details.",
          errors: validation.error.issues.map((issue) => ({
            field: issue.path.join(".") || "form",
            message: issue.message,
          })),
        },
        400,
      );
    }

    const unit = await createUnitForChairman(
      session.userId,
      society.data,
      validation.data,
    );

    return jsonNoStore(
      { message: "Unit created successfully.", unit },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
