import { z } from "zod";
import {
  logoutChairmanMobileSession,
} from "@/lib/server/auth/services/mobile-logout-service";
import {
  JsonRequestError,
  jsonNoStore,
  readBoundedJson,
} from "@/lib/server/http/json";

export const runtime = "nodejs";

const logoutSchema = z.strictObject({
  refreshToken: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function POST(request: Request): Promise<Response> {
  const allowedOrigin = process.env.APP_ORIGIN;

  if (!allowedOrigin) {
    return jsonNoStore(
      {
        code: "not_configured",
        message: "Logout is not configured.",
      },
      503,
    );
  }

  const origin = request.headers.get("origin");

  if (origin !== null && origin !== allowedOrigin) {
    return jsonNoStore(
      {
        code: "origin_not_permitted",
        message: "Request origin is not permitted.",
      },
      403,
    );
  }

  try {
    const body = await readBoundedJson(request);
    const validation = logoutSchema.safeParse(body);

    if (!validation.success) {
      return jsonNoStore(
        {
          code: "invalid_request",
          message: "Send a valid refresh token.",
        },
        400,
      );
    }

    await logoutChairmanMobileSession(
      validation.data.refreshToken,
    );

    return jsonNoStore({
      message: "Signed out successfully.",
    });
  } catch (error) {
    if (error instanceof JsonRequestError) {
      return jsonNoStore(
        {
          code: "invalid_request",
          message: error.message,
        },
        error.status,
      );
    }

    console.error("Mobile logout failed.");

    return jsonNoStore(
      {
        code: "temporarily_unavailable",
        message: "Unable to sign out. Please try again.",
      },
      503,
    );
  }
}
