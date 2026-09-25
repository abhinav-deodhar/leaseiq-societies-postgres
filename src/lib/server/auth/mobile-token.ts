import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Short-lived API access. The persistent mobile session will allow
// renewal without asking the user to enter their password again.
export const MOBILE_ACCESS_TOKEN_SECONDS = 15 * 60;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export type MobileTokenPair = {
  accessToken: string;
  refreshToken: string;
};

// Tokens must never be printed, logged, or included in error messages.
export function createMobileTokenPair(): MobileTokenPair {
  return {
    accessToken: randomBytes(32).toString("hex"),
    refreshToken: randomBytes(32).toString("hex"),
  };
}

export function isValidMobileToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function hashMobileToken(token: string): string {
  if (!isValidMobileToken(token)) {
    throw new Error("Invalid mobile token format.");
  }

  return createHash("sha256").update(token, "utf8").digest("hex");
}
