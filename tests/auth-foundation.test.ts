import assert from "node:assert/strict";
import { test } from "node:test";
import { registrationSchema } from "../src/lib/validation/auth";
import {
  hashPassword,
  verifyPassword,
} from "../src/lib/server/auth/password";

const validRegistration = {
  fullName: "  Test Chairman  ",
  email: "  CHAIRMAN@EXAMPLE.COM  ",
  phone: "9000000000",
  password: "A sample passphrase for testing!",
  confirmPassword: "A sample passphrase for testing!",
    dateOfBirth: "1995-06-15",
};

test("valid registration normalizes contact details", () => {
  const result = registrationSchema.parse(validRegistration);

  assert.equal(result.fullName, "Test Chairman");
  assert.equal(result.email, "chairman@example.com");
  assert.equal(result.phone, "+919000000000");
  assert.equal(result.password, validRegistration.password);
  assert.equal("confirmPassword" in result, false);
    assert.equal(result.dateOfBirth, "1995-06-15");
});

test("invalid registration fields are rejected", () => {
  const invalidChanges = [
    { fullName: " " },
    { email: "not-an-email" },
    { phone: "123" },
    { phone: "abcdefghij" },
    { password: "short", confirmPassword: "short" },
    { password: " ".repeat(20), confirmPassword: " ".repeat(20) },
    {
      password: "a".repeat(129),
      confirmPassword: "a".repeat(129),
    },
    { confirmPassword: "A different password entirely!" },
  ];

  for (const change of invalidChanges) {
    const result = registrationSchema.safeParse({
      ...validRegistration,
      ...change,
    });

    assert.equal(
      result.success,
      false,
      `Expected rejection for: ${Object.keys(change).join(", ")}`,
    );
  }
});

test("public registration rejects an injected admin role", () => {
  const result = registrationSchema.safeParse({
    ...validRegistration,
    role: "admin",
  });

  assert.equal(result.success, false);
});

test("password hashes verify correctly and use different salts", async () => {
  const password = validRegistration.password;
  const firstHash = await hashPassword(password);
  const secondHash = await hashPassword(password);

  assert.notEqual(firstHash, password);
  assert.notEqual(firstHash, secondHash);

  assert.equal(await verifyPassword(password, firstHash), true);
  assert.equal(
    await verifyPassword("This is the wrong password!", firstHash),
    false,
  );

  assert.equal(await verifyPassword(password, "invalid-hash"), false);
});

test("registration requires a real date of birth that is not in the future", () => {
  for (const dateOfBirth of [
    undefined,
    "",
    "not-a-date",
    "2025-02-29",
    "2000-02-30",
    "9999-12-31",
  ]) {
    assert.equal(
      registrationSchema.safeParse({
        ...validRegistration,
        dateOfBirth,
      }).success,
      false,
    );
  }

  assert.equal(
    registrationSchema.safeParse({
      ...validRegistration,
      dateOfBirth: "2000-02-29",
    }).success,
    true,
  );
});

test("registration requires both email and mobile number", () => {
  for (const change of [
    { email: "" },
    { email: undefined },
    { phone: "" },
    { phone: undefined },
  ]) {
    assert.equal(
      registrationSchema.safeParse({
        ...validRegistration,
        ...change,
      }).success,
      false,
    );
  }
});