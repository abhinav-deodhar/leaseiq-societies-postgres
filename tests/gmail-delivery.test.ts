import assert from "node:assert/strict";
import test from "node:test";
import {
  createGmailDelivery,
  EmailDeliveryError,
} from "../src/lib/server/auth/gmail-delivery";

const config = {
  clientId: "test-client",
  clientSecret: "test-secret",
  refreshToken: "test-refresh",
  senderEmail: "leaseiq@example.com",
};

function input() {
  return {
    destination: "recipient@example.com",
    code: "012345",
    expiresAt: new Date(Date.now() + 600_000),
  };
}

function hasCode(code: EmailDeliveryError["code"]) {
  return (error: unknown) =>
    error instanceof EmailDeliveryError && error.code === code;
}

test("sends the OTP as a MIME email and returns Gmail's message ID", async () => {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  const fakeFetch: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(calls.length === 1
      ? { access_token: "test-access" }
      : { id: "message-123" });
  };

  const result = await createGmailDelivery(config, fakeFetch)(input());
  assert.equal(result.providerMessageId, "message-123");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");

  const tokenBody = new URLSearchParams(String(calls[0].options?.body));
  assert.equal(tokenBody.get("grant_type"), "refresh_token");
  assert.equal(tokenBody.get("refresh_token"), "test-refresh");

  const requestBody = JSON.parse(String(calls[1].options?.body));
  const mime = Buffer.from(requestBody.raw, "base64url").toString("utf8");
  assert.match(mime, /From: LeaseIQ Communications <leaseiq@example.com>/);
  assert.match(mime, /To: recipient@example.com/);
  const encodedBody = mime.split("\r\n\r\n")[1];
  const text = Buffer.from(encodedBody, "base64").toString("utf8");
  assert.match(text, /012345/);
  assert.equal(calls[1].options?.redirect, "error");
});

test("rejects missing configuration", () => {
  assert.throws(
    () => createGmailDelivery({ ...config, refreshToken: "" }),
    hasCode("CONFIGURATION"),
  );
});

test("rejects header injection, malformed codes and expired codes before networking", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    throw new Error("Unexpected network call");
  };
  const send = createGmailDelivery(config, fakeFetch);

  for (const value of [
    { ...input(), destination: "recipient@example.com\r\nBcc: other@example.com" },
    { ...input(), code: "12345" },
    { ...input(), expiresAt: new Date(Date.now() - 1) },
  ]) {
    await assert.rejects(send(value), hasCode("INVALID_INPUT"));
  }
  assert.equal(calls, 0);
});

test("token failure never attempts to send or exposes provider secrets", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return Response.json({ error: "test-secret" }, { status: 400 });
  };
  await assert.rejects(
    createGmailDelivery(config, fakeFetch)(input()),
    hasCode("TOKEN_FAILED"),
  );
  assert.equal(calls, 1);
});

test("an uncertain send is not automatically retried", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) return Response.json({ access_token: "test-access" });
    throw new Error("Connection lost after request");
  };
  await assert.rejects(
    createGmailDelivery(config, fakeFetch)(input()),
    hasCode("SEND_UNCONFIRMED"),
  );
  assert.equal(calls, 2);
});

test("a response without a message ID does not claim successful delivery", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return Response.json(calls === 1 ? { access_token: "test-access" } : {});
  };
  await assert.rejects(
    createGmailDelivery(config, fakeFetch)(input()),
    hasCode("SEND_UNCONFIRMED"),
  );
});
