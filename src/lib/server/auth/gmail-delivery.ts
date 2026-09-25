import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";

type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderEmail: string;
};

type VerificationEmail = {
  destination: string;
  code: string;
  expiresAt: Date;
};

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
      `Your LeaseIQ email verification code is: ${input.code}`,
      "",
      `This code expires at ${input.expiresAt.toISOString()} (UTC).`,
      "Do not share this code with anyone.",
      "If you did not request this code, you can ignore this email.",
      "",
      "LeaseIQ Communications",
    ].join("\r\n");

    const message = [
      `From: LeaseIQ Communications <${config.senderEmail}>`,
      `To: ${input.destination}`,
      "Subject: Your LeaseIQ verification code",
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@${config.senderEmail.split("@")[1]}>`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g)!.join("\r\n"),
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
