import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGmailDelivery,
  EmailDeliveryError,
  type VerificationEmailPurpose,
} from "../src/lib/server/auth/gmail-delivery";

const config = {
  clientId: "test-client",
  clientSecret: "test-secret",
  refreshToken: "test-refresh-token",
  senderEmail: "sender@example.invalid",
};

function captureDelivery() {
  const messages: string[] = [];
  const requests: string[] = [];

  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);

    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "test-access-token" });
    }

    assert.equal(
      url,
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as { raw: string };
    messages.push(Buffer.from(body.raw, "base64url").toString("utf8"));
    return Response.json({ id: "test-message-id" });
  };

  return {
    send: createGmailDelivery(config, fetcher),
    messages,
    requests,
  };
}

function decodedParts(message: string): string[] {
  return [...message.matchAll(
    /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g,
  )].map(match =>
    Buffer.from(match[1].replace(/\r\n/g, ""), "base64").toString("utf8"),
  );
}

const cases: Array<{
  purpose: VerificationEmailPurpose | undefined;
  subject: string;
  heading: string;
}> = [
  {
    purpose: undefined,
    subject: "Verify your email - LeaseIQ",
    heading: "Verify your email address",
  },
  {
    purpose: "login",
    subject: "Your sign-in code - LeaseIQ",
    heading: "Sign in to LeaseIQ",
  },
  {
    purpose: "reset_password",
    subject: "Reset your password - LeaseIQ",
    heading: "Reset your password",
  },
];

for (const item of cases) {
  test(`email delivery uses correct copy for ${item.purpose ?? "registration"}`, async () => {
    const delivery = captureDelivery();
    const result = await delivery.send({
      destination: "resident@example.invalid",
      code: "001234",
      expiresAt: new Date(Date.now() + 600_000),
      ...(item.purpose ? { purpose: item.purpose } : {}),
    });

    assert.equal(result.providerMessageId, "test-message-id");
    assert.equal(delivery.requests.length, 2);
    assert.equal(delivery.messages.length, 1);

    const message = delivery.messages[0];
    assert.ok(message.includes(`Subject: ${item.subject}\r\n`));

    const parts = decodedParts(message);
    assert.equal(parts.length, 2);
    for (const part of parts) assert.ok(part.includes("001234"));
    assert.ok(parts[1].includes(item.heading));

    if (item.purpose) {
      assert.ok(!parts[1].includes("continue setting up your account"));
    }
    if (item.purpose === "reset_password") {
      assert.ok(parts[0].includes(
        "Requesting this code does not change your password.",
      ));
    }
  });
}

test("unsupported email purposes are rejected before contacting Gmail", async () => {
  const delivery = captureDelivery();
  await assert.rejects(
    delivery.send({
      destination: "resident@example.invalid",
      code: "001234",
      expiresAt: new Date(Date.now() + 600_000),
      purpose: "unknown" as VerificationEmailPurpose,
    }),
    error => error instanceof EmailDeliveryError &&
      error.code === "INVALID_INPUT",
  );
  assert.equal(delivery.requests.length, 0);
});

test("expired login codes are rejected before contacting Gmail", async () => {
  const delivery = captureDelivery();
  await assert.rejects(
    delivery.send({
      destination: "resident@example.invalid",
      code: "001234",
      expiresAt: new Date(Date.now() - 1000),
      purpose: "login",
    }),
    error => error instanceof EmailDeliveryError &&
      error.code === "INVALID_INPUT",
  );
  assert.equal(delivery.requests.length, 0);
});
