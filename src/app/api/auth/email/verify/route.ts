import {
  EMAIL_AUTH_POLICY, emailAuthVerifySchema,
} from "@/lib/contracts/email-auth";
import { HttpError } from "@/lib/server/http";
import { verifyEmailCode } from "@/lib/server/auth/email-auth-service";
import {
  emailAuthFailure, emailAuthJson, readEmailAuthBody,
  resetCookieName, resetCookiePath,
} from "@/lib/server/auth/email-auth-http";
import { sessionCookieName } from "@/lib/server/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const parsed = emailAuthVerifySchema.safeParse(
      await readEmailAuthBody(request),
    );
    if (!parsed.success) throw new HttpError(400, "Enter a valid six-digit code.");
    const result = await verifyEmailCode(parsed.data);

    if (result.kind === "login") {
      const response = emailAuthJson({
        kind: "login",
        message: "Signed in successfully.",
        user: result.user,
        expiresAt: result.expiresAt,
      });
      response.cookies.set(
        sessionCookieName(result.user.portal), result.token,
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 8 * 60 * 60,
        },
      );
      return response;
    }

    const response = emailAuthJson({
      kind: "reset_password",
      message: "Email verified. Choose your new password.",
      expiresAt: result.expiresAt,
    });
    response.cookies.set(
      resetCookieName(parsed.data.portal), result.resetToken,
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: resetCookiePath,
        maxAge: EMAIL_AUTH_POLICY.resetLifetimeSeconds,
      },
    );
    return response;
  } catch (error) {
    return emailAuthFailure(error);
  }
}
