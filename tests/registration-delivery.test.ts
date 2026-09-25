import assert from "node:assert/strict";
import test from "node:test";
import {
  registrationDeliveryMode,
} from "../src/lib/server/auth/registration-delivery";

const gmail: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  VERIFICATION_DELIVERY: "gmail",
  GMAIL_CLIENT_ID: "test-client",
  GMAIL_CLIENT_SECRET: "test-secret",
  GMAIL_REFRESH_TOKEN: "test-refresh",
  GMAIL_SENDER_EMAIL: "sender@example.com",
};

test("missing configuration does not enable registration", () => {
  assert.equal(registrationDeliveryMode({}), null);
  assert.equal(
    registrationDeliveryMode({ NODE_ENV: "development" }),
    null,
  );
});

test("existing development console mode remains available", () => {
  assert.equal(registrationDeliveryMode({
    NODE_ENV: "development",
    VERIFICATION_DELIVERY: "console",
  }), "console");
});

test("Gmail mode requires all four settings", () => {
  assert.equal(registrationDeliveryMode(gmail), "gmail");
  for (const name of [
    "GMAIL_CLIENT_ID",
    "GMAIL_CLIENT_SECRET",
    "GMAIL_REFRESH_TOKEN",
    "GMAIL_SENDER_EMAIL",
  ]) {
    assert.equal(
      registrationDeliveryMode({ ...gmail, [name]: " " }),
      null,
    );
  }
});

test("production cannot accidentally enable console phone verification", () => {
  for (const mode of ["console", "gmail"]) {
    assert.equal(registrationDeliveryMode({
      ...gmail,
      NODE_ENV: "production",
      VERIFICATION_DELIVERY: mode,
    }), null);
  }
});
