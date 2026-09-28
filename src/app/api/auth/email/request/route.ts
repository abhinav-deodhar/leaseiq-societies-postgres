import { after } from "next/server";
import { requestEmailCode } from "@/lib/server/auth/email-auth-service";
import {
  emailAuthFailure, emailAuthJson, readEmailAuthBody,
} from "@/lib/server/auth/email-auth-http";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const result = await requestEmailCode(await readEmailAuthBody(request));
    after(result.deliver);
    return emailAuthJson({
      message: "If this email belongs to an eligible account, a code will arrive shortly. Check your inbox and spam folder.",
      challengeId: result.challengeId,
      expiresAt: result.expiresAt,
      retryAfterSeconds: result.retryAfterSeconds,
    }, 202);
  } catch (error) {
    return emailAuthFailure(error);
  }
}
