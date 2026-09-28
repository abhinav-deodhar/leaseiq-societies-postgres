import type { NextRequest } from "next/server";
import { z } from "zod";
import { emailAuthPortalSchema } from "@/lib/contracts/email-auth";
import { passwordSchema } from "@/lib/validation/auth";
import { HttpError } from "@/lib/server/http";
import { resetEmailPassword } from "@/lib/server/auth/email-auth-service";
import {
  emailAuthFailure, emailAuthJson, readEmailAuthBody,
  resetCookieName, resetCookiePath,
} from "@/lib/server/auth/email-auth-http";
import { sessionCookieName } from "@/lib/server/auth/session";

export const runtime = "nodejs";

const formSchema = z.strictObject({
  portal: emailAuthPortalSchema,
  newPassword: passwordSchema,
  confirmPassword: z.string().max(128),
}).refine(value => value.newPassword === value.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
});

export async function POST(request: NextRequest) {
  try {
    const parsed = formSchema.safeParse(await readEmailAuthBody(request));
    if (!parsed.success) {
      throw new HttpError(
        400, parsed.error.issues[0]?.message ?? "Check your new password.",
      );
    }
    const resetToken = request.cookies.get(
      resetCookieName(parsed.data.portal),
    )?.value;
    if (!resetToken) {
      throw new HttpError(400, "Your reset session has expired. Request a new code.");
    }

    await resetEmailPassword({ ...parsed.data, resetToken });
    const response = emailAuthJson({
      message: "Your password has been reset. Sign in with your new password. Existing sessions have been signed out.",
    });

    for (const portal of ["chairman", "resident"] as const) {
      response.cookies.set(sessionCookieName(portal), "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      response.cookies.set(resetCookieName(portal), "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: resetCookiePath,
        maxAge: 0,
      });
    }
    return response;
  } catch (error) {
    return emailAuthFailure(error);
  }
}
