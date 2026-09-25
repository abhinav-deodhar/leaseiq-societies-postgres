import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  createVerificationCode,
  isConsoleDeliveryAllowed,
  matchesVerificationCode,
  MAX_VERIFICATION_ATTEMPTS,
  VERIFICATION_LIFETIME_MS,
} from "../src/lib/server/auth/verification-code";

// A temporary key for this test process only.
// This does not read or change .env.local.
process.env.OTP_HASH_SECRET = randomBytes(32).toString("hex");

test("creates a six-digit code with the expected expiry and attempt limit", () => {
  const challenge = createVerificationCode();

  assert.match(challenge.code, /^[0-9]{6}$/);
  assert.match(challenge.codeHash, /^[0-9a-f]{64}$/);

  assert.equal(
    challenge.expiresAt.getTime() - challenge.createdAt.getTime(),
    VERIFICATION_LIFETIME_MS,
  );

  assert.equal(challenge.maxAttempts, MAX_VERIFICATION_ATTEMPTS);
});

test("accepts the correct code and rejects a different code", () => {
  const challenge = createVerificationCode();

  const wrongCode = challenge.code === "000000" ? "000001" : "000000";

  assert.equal(
    matchesVerificationCode(
      challenge.id,
      challenge.code,
      challenge.codeHash,
    ),
    true,
  );

  assert.equal(
    matchesVerificationCode(challenge.id, wrongCode, challenge.codeHash),
    false,
  );
});

test("a code hash cannot be transferred to a different request", () => {
  const challenge = createVerificationCode();

  assert.equal(
    matchesVerificationCode(
      randomUUID(),
      challenge.code,
      challenge.codeHash,
    ),
    false,
  );
});

test("rejects malformed codes and hashes", () => {
  const challenge = createVerificationCode();

  for (const code of ["", "12345", "1234567", "abcdef", " 123456"]) {
    assert.equal(
      matchesVerificationCode(challenge.id, code, challenge.codeHash),
      false,
    );
  }

  assert.equal(
    matchesVerificationCode(challenge.id, challenge.code, "invalid"),
    false,
  );
});

test("console delivery is allowed only in explicitly configured development", () => {
  assert.equal(isConsoleDeliveryAllowed("development", "console"), true);

  assert.equal(isConsoleDeliveryAllowed("production", "console"), false);
  assert.equal(isConsoleDeliveryAllowed("test", "console"), false);
  assert.equal(isConsoleDeliveryAllowed(undefined, "console"), false);
  assert.equal(isConsoleDeliveryAllowed("development", undefined), false);
  assert.equal(isConsoleDeliveryAllowed("development", "sms"), false);
});