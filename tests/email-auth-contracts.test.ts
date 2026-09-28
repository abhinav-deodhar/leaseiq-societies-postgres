import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emailAuthRequestSchema,
  emailAuthVerifySchema,
  emailPasswordResetSchema,
} from "../src/lib/contracts/email-auth";

const request = {
  email: "resident@example.com",
  portal: "resident",
  purpose: "login",
};

const verification = {
  challengeId: "123e4567-e89b-42d3-a456-426614174000",
  portal: "resident",
  purpose: "login",
  code: "001234",
};

const reset = {
  portal: "resident",
  resetToken: "a".repeat(64),
  newPassword: "A-long-new-password!2026",
  confirmPassword: "A-long-new-password!2026",
};

test("email requests normalize email for both supported portals and purposes", () => {
  for (const portal of ["chairman", "resident"]) {
    for (const purpose of ["login", "reset_password"]) {
      const parsed = emailAuthRequestSchema.parse({
        email: "  Person@Example.COM  ",
        portal,
        purpose,
      });
      assert.equal(parsed.email, "person@example.com");
      assert.equal(parsed.portal, portal);
      assert.equal(parsed.purpose, purpose);
    }
  }
});

test("email requests reject admin, registration purposes and supplied identity fields", () => {
  for (const input of [
    { ...request, portal: "admin" },
    { ...request, purpose: "verify_email" },
    { ...request, email: "not-an-email" },
    { ...request, email: "a".repeat(255) + "@example.com" },
    { ...request, userId: verification.challengeId },
    { ...request, destination: "someone-else@example.com" },
    { ...request, client: "android" },
  ]) {
    assert.equal(emailAuthRequestSchema.safeParse(input).success, false);
  }
});

test("verification preserves leading zeroes and requires an exact six-digit string", () => {
  assert.equal(emailAuthVerifySchema.parse(verification).code, "001234");

  for (const code of ["12345", "1234567", " 001234", "001234 ", "abcdef", 123456]) {
    assert.equal(
      emailAuthVerifySchema.safeParse({ ...verification, code }).success,
      false,
    );
  }
});

test("verification rejects invalid handles, unsupported portals and unknown fields", () => {
  for (const input of [
    { ...verification, challengeId: "invalid" },
    { ...verification, portal: "admin" },
    { ...verification, purpose: "verify_email" },
    { ...verification, userId: verification.challengeId },
  ]) {
    assert.equal(emailAuthVerifySchema.safeParse(input).success, false);
  }
});

test("password reset requires a reset token and matching passwords", () => {
  assert.equal(emailPasswordResetSchema.safeParse(reset).success, true);

  const mismatch = emailPasswordResetSchema.safeParse({
    ...reset,
    confirmPassword: "A-different-password!2026",
  });
  assert.equal(mismatch.success, false);
  if (!mismatch.success) {
    assert.ok(mismatch.error.issues.some(
      issue => issue.path[0] === "confirmPassword",
    ));
  }

  for (const input of [
    { ...reset, resetToken: "123456" },
    { ...reset, resetToken: "g".repeat(64) },
    { ...reset, portal: "admin" },
    { ...reset, userId: verification.challengeId },
    { ...reset, code: "001234" },
  ]) {
    assert.equal(emailPasswordResetSchema.safeParse(input).success, false);
  }
});

test("password reset enforces the existing password policy without trimming passwords", () => {
  for (const password of ["short", " ".repeat(20), "a".repeat(129)]) {
    assert.equal(emailPasswordResetSchema.safeParse({
      ...reset,
      newPassword: password,
      confirmPassword: password,
    }).success, false);
  }

  const password = "  A-long-password!2026  ";
  const parsed = emailPasswordResetSchema.parse({
    ...reset,
    newPassword: password,
    confirmPassword: password,
  });
  assert.equal(parsed.newPassword, password);
});
