import "server-only";
import { NextResponse } from "next/server";
import { HttpError, readJsonBody } from "../http";
import type { EmailAuthPortal } from "../../contracts/email-auth";
import { EmailAuthRateLimitError } from "./email-auth-service";

export async function readEmailAuthBody(request: Request): Promise<unknown> {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new HttpError(503, "Authentication is not configured.");
  // These endpoints serve the web forms. Require an exact browser origin.
  if (request.headers.get("origin") !== origin) {
    throw new HttpError(403, "Request origin is not permitted.");
  }
  return readJsonBody(request, 4096);
}

export function emailAuthJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function emailAuthFailure(error: unknown) {
  if (error instanceof HttpError) {
    const response = emailAuthJson({ message: error.message }, error.status);
    if (error instanceof EmailAuthRateLimitError) {
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return response;
  }
  console.error("Email authentication operation failed.");
  return emailAuthJson({
    message: "The operation could not be confirmed. Please try again shortly.",
  }, 503);
}

export function resetCookieName(portal: EmailAuthPortal) {
  return `leaseiq_${portal}_password_reset`;
}

export const resetCookiePath = "/api/auth/email/reset";
