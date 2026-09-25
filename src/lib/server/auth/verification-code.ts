import "server-only";
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export const VERIFICATION_LIFETIME_MS = 10 * 60 * 1000;
export const MAX_VERIFICATION_ATTEMPTS = 5;

function getHashSecret(): Buffer {
  const secret = process.env.OTP_HASH_SECRET;

  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error(
      "OTP_HASH_SECRET must contain exactly 64 hexadecimal characters.",
    );
  }

  return Buffer.from(secret, "hex");
}

function hashCode(challengeId: string, code: string): string {
  return createHmac("sha256", getHashSecret())
    .update(JSON.stringify(["leaseiq-verification-v1", challengeId, code]))
    .digest("hex");
}

export function createVerificationCode() {
  const id = randomUUID();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const createdAt = new Date();

  return {
    id,
    code,
    codeHash: hashCode(id, code),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + VERIFICATION_LIFETIME_MS),
    maxAttempts: MAX_VERIFICATION_ATTEMPTS,
  };
}

export function matchesVerificationCode(
  challengeId: string,
  submittedCode: string,
  storedHash: string,
): boolean {
  if (
    !/^[0-9]{6}$/.test(submittedCode) ||
    !/^[0-9a-f]{64}$/.test(storedHash)
  ) {
    return false;
  }

  const candidateHash = hashCode(challengeId, submittedCode);

  return timingSafeEqual(
    Buffer.from(candidateHash, "hex"),
    Buffer.from(storedHash, "hex"),
  );
}

export function isConsoleDeliveryAllowed(
  environment: string | undefined,
  delivery: string | undefined,
): boolean {
  return environment === "development" && delivery === "console";
}

export function assertDevelopmentDelivery(): void {
  if (
    !isConsoleDeliveryAllowed(
      process.env.NODE_ENV,
      process.env.VERIFICATION_DELIVERY,
    )
  ) {
    throw new Error(
      "Console verification delivery is available only in development.",
    );
  }
}

export function deliverDevelopmentCode(
  channel: "email" | "sms",
  challenge: ReturnType<typeof createVerificationCode>,
): void {
  assertDevelopmentDelivery();

  console.info(
    `[DEV VERIFICATION] ${channel} | request=${challenge.id} | code=${challenge.code}`,
  );
}