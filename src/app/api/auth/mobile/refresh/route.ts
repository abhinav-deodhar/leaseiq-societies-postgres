import { z } from "zod";
import {
  refreshChairmanMobileSession,
  type MobileRefreshFailure,
} from "@/lib/server/auth/services/mobile-refresh-service";
import {
  JsonRequestError,
  jsonNoStore,
  readBoundedJson,
} from "@/lib/server/http/json";

export const runtime = "nodejs";

const refreshSchema = z.strictObject({
  refreshToken: z.string().regex(/^[0-9a-f]{64}$/),
  replacementRefreshToken: z.string().regex(/^[0-9a-f]{64}$/),
});

const failureResponses: Record<
  MobileRefreshFailure,
  { status: number; message: string }
> = {
  invalid_request: {
    status: 400,
    message: "Send valid, different refresh tokens.",
  },
  invalid_session: {
    status: 401,
    message: "Please sign in again.",
  },
  account_not_allowed: {
    status: 403,
    message: "This account cannot access the app.",
  },
  token_reuse: {
    status: 401,
    message: "This session has been revoked. Please sign in again.",
  },
  stale_retry: {
    status: 409,
    message: "This renewal has already been superseded.",
  },
  replacement_conflict: {
    status: 409,
    message: "Generate a new replacement token and retry.",
  },
};

export async function POST(request: Request): Promise<Response> {
  const allowedOrigin = process.env.APP_ORIGIN;

  if (!allowedOrigin) {
    return jsonNoStore(
      {
        code: "not_configured",
        message: "Session renewal is not configured.",
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
    const validation = refreshSchema.safeParse(body);

    if (!validation.success) {
      return jsonNoStore(
        {
          code: "invalid_request",
          message: "Send valid refresh and replacement tokens.",
        },
        400,
      );
    }

    const result = await refreshChairmanMobileSession(
      validation.data.refreshToken,
      validation.data.replacementRefreshToken,
    );

    if (!result.ok) {
      const failure = failureResponses[result.reason];

      return jsonNoStore(
        {
          code: result.reason,
          message: failure.message,
        },
        failure.status,
      );
    }

    return jsonNoStore({
      message: "Session renewed successfully.",
      ...result.session,
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

    // Do not log request bodies, credentials, or token values.
    console.error("Mobile session renewal failed.");

    return jsonNoStore(
      {
        code: "temporarily_unavailable",
        message: "Unable to renew your session. Please try again.",
      },
      503,
    );
  }
}
