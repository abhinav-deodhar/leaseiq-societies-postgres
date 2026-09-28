import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";

type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderEmail: string;
};

export type VerificationEmailPurpose =
  | "verify_email"
  | "login"
  | "reset_password";

type VerificationEmail = {
  destination: string;
  code: string;
  expiresAt: Date;
  purpose?: VerificationEmailPurpose;
};

const emailCopy = {
  verify_email: {
    subject: "Verify your email - LeaseIQ",
    preview: "Your LeaseIQ email verification code is ready.",
    heading: "Verify your email address",
    instruction: "Enter this code on the LeaseIQ verification screen to continue setting up your account.",
    plainLabel: "email verification",
    codeLabel: "YOUR VERIFICATION CODE",
    footer: "Account verification",
  },
  login: {
    subject: "Your sign-in code - LeaseIQ",
    preview: "Your LeaseIQ sign-in code is ready.",
    heading: "Sign in to LeaseIQ",
    instruction: "Enter this code on the LeaseIQ email sign-in screen. This code signs you in without your password.",
    plainLabel: "sign-in",
    codeLabel: "YOUR SIGN-IN CODE",
    footer: "Account sign-in",
  },
  reset_password: {
    subject: "Reset your password - LeaseIQ",
    preview: "Your LeaseIQ password reset code is ready.",
    heading: "Reset your password",
    instruction: "Enter this code on the LeaseIQ password recovery screen to choose a new password. Requesting this code does not change your password.",
    plainLabel: "password reset",
    codeLabel: "YOUR PASSWORD RESET CODE",
    footer: "Password recovery",
  },
} as const;

export class EmailDeliveryError extends Error {
  constructor(
    readonly code:
      | "CONFIGURATION"
      | "INVALID_INPUT"
      | "TOKEN_FAILED"
      | "SEND_UNCONFIRMED",
  ) {
    super(`Email delivery failed: ${code}.`);
    this.name = "EmailDeliveryError";
  }
}

function validEmail(value: string): boolean {
  return /^[\x21-\x7e]+$/.test(value) && z.email().safeParse(value).success;
}

function assertUnexpired(expiresAt: Date): void {
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) {
    throw new EmailDeliveryError("INVALID_INPUT");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createGmailDelivery(
  config: GmailConfig,
  fetcher: typeof fetch = fetch,
) {
  if (
    !config.clientId?.trim() ||
    !config.clientSecret?.trim() ||
    !config.refreshToken?.trim() ||
    !validEmail(config.senderEmail)
  ) {
    throw new EmailDeliveryError("CONFIGURATION");
  }

  return async function sendVerificationEmail(input: VerificationEmail) {
    const purpose = input.purpose ?? "verify_email";
    if (
      purpose !== "verify_email" &&
      purpose !== "login" &&
      purpose !== "reset_password"
    ) {
      throw new EmailDeliveryError("INVALID_INPUT");
    }
    const copy = emailCopy[purpose];

    if (
      !validEmail(input.destination) ||
      !/^[0-9]{6}$/.test(input.code)
    ) {
      throw new EmailDeliveryError("INVALID_INPUT");
    }
    assertUnexpired(input.expiresAt);

    let accessToken: string;
    try {
      const response = await fetcher("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: config.refreshToken,
          grant_type: "refresh_token",
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) throw new Error("Token rejected");
      const data: unknown = await response.json();
      if (
        !isRecord(data) ||
        typeof data.access_token !== "string" ||
        !data.access_token
      ) {
        throw new Error("Invalid token response");
      }
      accessToken = data.access_token;
    } catch {
      // Do not expose provider responses, credentials, or request bodies.
      throw new EmailDeliveryError("TOKEN_FAILED");
    }

    assertUnexpired(input.expiresAt);

    const body = [
      "Hello,",
      "",
      `Your LeaseIQ ${copy.plainLabel} code is: ${input.code}`,
      "",
      `This code expires at ${input.expiresAt.toISOString()} (UTC).`,
      "Do not share this code with anyone.",
      ...(purpose === "verify_email" ? [] : [copy.instruction, ""]),
      "If you did not request this code, you can ignore this email.",
      "",
      "LeaseIQ Communications",
    ].join("\r\n");

    const expiry = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }).format(input.expiresAt);

    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif;color:#172b25">
<div style="display:none;max-height:0;overflow:hidden">${copy.preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f5">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dce7e2;border-radius:16px">
<tr><td style="padding:28px 32px;background:#005e46;border-radius:16px 16px 0 0">
<div style="font-size:28px;font-weight:bold;color:#ffffff">LeaseIQ</div>
<div style="margin-top:6px;font-size:13px;color:#d9f4e8">COMMUNICATIONS</div>
</td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 16px;font-size:24px;line-height:32px">${copy.heading}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:26px;color:#455b52">${copy.instruction}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 12px;background:#edfaf3;border:1px solid #bde4d0;border-radius:12px">
<div style="font-size:12px;letter-spacing:1px;color:#426555">${copy.codeLabel}</div>
<div style="margin-top:12px;font-family:Consolas,monospace;font-size:36px;font-weight:bold;letter-spacing:6px;color:#005e46">${input.code}</div>
</td></tr></table>
<p style="margin:20px 0 0;font-size:14px;line-height:23px;color:#455b52">Valid until <strong>${expiry} IST</strong>. This code can be used once.</p>
<p style="margin:20px 0 0;font-size:14px;line-height:23px;color:#455b52">Keep this code private. LeaseIQ will never ask you to share it by phone or message.</p>
<p style="margin:20px 0 0;font-size:13px;line-height:22px;color:#687b72">If you did not request this email, you can ignore it.</p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e5ece8;font-size:12px;line-height:20px;color:#687b72">LeaseIQ Communications<br>${copy.footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;

    const boundary = `leaseiq_${randomUUID()}`;
    const encodePart = (value: string) =>
      Buffer.from(value, "utf8").toString("base64")
        .match(/.{1,76}/g)!.join("\r\n");

    const message = [
      `From: LeaseIQ Communications <${config.senderEmail}>`,
      `To: ${input.destination}`,
      `Subject: ${copy.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@${config.senderEmail.split("@")[1]}>`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      encodePart(body),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      encodePart(html),
      `--${boundary}--`,
      "",
    ].join("\r\n");

    try {
      const response = await fetcher(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            raw: Buffer.from(message, "utf8").toString("base64url"),
          }),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!response.ok) throw new Error("Sending rejected");
      const data: unknown = await response.json();
      if (!isRecord(data) || typeof data.id !== "string" || !data.id) {
        throw new Error("Missing message ID");
      }

      return { providerMessageId: data.id };
    } catch {
      // Delivery might have happened. Do not automatically send a duplicate.
      throw new EmailDeliveryError("SEND_UNCONFIRMED");
    }
  };
}

export async function deliverEmailVerification(input: VerificationEmail) {
  const send = createGmailDelivery({
    clientId: process.env.GMAIL_CLIENT_ID ?? "",
    clientSecret: process.env.GMAIL_CLIENT_SECRET ?? "",
    refreshToken: process.env.GMAIL_REFRESH_TOKEN ?? "",
    senderEmail: process.env.GMAIL_SENDER_EMAIL ?? "",
  });
  return send(input);
}
