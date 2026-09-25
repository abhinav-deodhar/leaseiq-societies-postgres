import {
  resendRegistrationEmail,
  EmailResendError,
} from "@/lib/server/auth/email-resend";
import {
  checkRequestOrigin,
  HttpError,
  readJsonBody,
} from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    checkRequestOrigin(request);
    const result = await resendRegistrationEmail(
      await readJsonBody(request, 2048),
    );
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof HttpError || error instanceof EmailResendError) {
      const headers: Record<string, string> = {
        "Cache-Control": "no-store",
      };
      const retry = error instanceof EmailResendError
        ? error.retryAfterSeconds : undefined;
      if (retry) headers["Retry-After"] = String(retry);

      return Response.json(
        {
          message: error.message,
          ...(retry ? { retryAfterSeconds: retry } : {}),
        },
        { status: error.status, headers },
      );
    }

    console.error("Email code resend could not be completed.");
    return Response.json(
      {
        message: "We could not confirm the resend. Wait one minute, then try again on this page.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
