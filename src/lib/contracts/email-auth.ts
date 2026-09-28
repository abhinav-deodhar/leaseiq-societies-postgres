import { z } from "zod";
import { passwordSchema } from "../validation/auth";

export const EMAIL_AUTH_POLICY = {
  codeLifetimeSeconds: 600,
  resetLifetimeSeconds: 600,
  maxCodeAttempts: 5,
  resendCooldownSeconds: 60,
  maxRequestsPerHour: 5,
} as const;

export const emailAuthPortalSchema = z.enum(["chairman", "resident"]);
export const emailAuthPurposeSchema = z.enum(["login", "reset_password"]);

const emailSchema = z.string()
  .trim()
  .toLowerCase()
  .max(254, "Email address is too long.")
  .pipe(z.email("Enter a valid email address."));

const codeSchema = z.string()
  .regex(/^[0-9]{6}$/, "Enter the six-digit code from your email.");

export const emailAuthRequestSchema = z.strictObject({
  email: emailSchema,
  portal: emailAuthPortalSchema,
  purpose: emailAuthPurposeSchema,
});

export const emailAuthVerifySchema = z.strictObject({
  challengeId: z.uuid(),
  portal: emailAuthPortalSchema,
  purpose: emailAuthPurposeSchema,
  code: codeSchema,
});

export const emailPasswordResetSchema = z.strictObject({
  portal: emailAuthPortalSchema,
  resetToken: z.string().regex(
    /^[0-9a-f]{64}$/,
    "This reset session is invalid. Request a new code.",
  ),
  newPassword: passwordSchema,
  confirmPassword: z.string().max(128, "Use no more than 128 characters."),
}).refine(
  value => value.newPassword === value.confirmPassword,
  {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  },
);

export type EmailAuthPortal = z.infer<typeof emailAuthPortalSchema>;
export type EmailAuthPurpose = z.infer<typeof emailAuthPurposeSchema>;
export type EmailAuthRequest = z.infer<typeof emailAuthRequestSchema>;
export type EmailAuthVerify = z.infer<typeof emailAuthVerifySchema>;
export type EmailPasswordReset = z.infer<typeof emailPasswordResetSchema>;
