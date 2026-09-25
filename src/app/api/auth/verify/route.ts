import {
  registrationDeliveryMode,
} from "@/lib/server/auth/registration-delivery";
import { checkRequestOrigin, HttpError } from "@/lib/server/http";
import { z } from "zod";
import { getDatabase } from "@/lib/server/db";
import {
  matchesVerificationCode,
} from "@/lib/server/auth/verification-code";

export const runtime = "nodejs";

const verificationSchema = z.strictObject({
  challengeId: z.uuid(),
  code: z.string().regex(/^[0-9]{6}$/, "Enter the six-digit code."),
});

type UserRow = {
  id: string;
  email: string;
  phone: string;
  status: string;
};

type ChallengeRow = {
  id: string;
  user_id: string;
  purpose: string;
  destination: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  consumed_at: Date | null;
  invalidated_at: Date | null;
  expired: boolean;
};

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) {
    throw new Error("Missing body");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;

      if (size > 2048) {
        await reader.cancel();
        throw new Error("Body too large");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function POST(request: Request) {
  if (!registrationDeliveryMode()) {
    return json({ message: "Verification is not available." }, 503);
  }

  try {
    checkRequestOrigin(request);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ message: error.message }, error.status);
    }
    return json({ message: "Verification is unavailable." }, 503);
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    return json({ message: "Send the request as application/json." }, 415);
  }

  let body: unknown;

  try {
    body = await readBody(request);
  } catch {
    return json(
      { message: "Send valid JSON with a body no larger than 2 KB." },
      400,
    );
  }

  const validation = verificationSchema.safeParse(body);

  if (!validation.success) {
    return json(
      { message: "Provide a valid challenge ID and six-digit code." },
      400,
    );
  }

  const { challengeId, code } = validation.data;

  try {
    const client = await getDatabase().connect();

    try {
      await client.query("BEGIN");

      const lookup = await client.query<{ user_id: string }>(
        `SELECT user_id
         FROM verification_challenges
         WHERE id = $1
           AND purpose IN ('verify_email', 'verify_phone')`,
        [challengeId],
      );

      if (lookup.rows.length === 0) {
        await client.query("ROLLBACK");
        return json({ message: "Verification request not found." }, 404);
      }

      // Lock the user first so simultaneous email and phone
      // requests cannot overwrite each other's verification state.
      const userResult = await client.query<UserRow>(
        `SELECT id, email, phone, status
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [lookup.rows[0].user_id],
      );

      const user = userResult.rows[0];

      if (!user || user.status === "disabled") {
        await client.query("ROLLBACK");
        return json({ message: "Verification is not permitted." }, 403);
      }

      const challengeResult = await client.query<ChallengeRow>(
        `SELECT id, user_id, purpose, destination, code_hash,
                attempts, max_attempts, consumed_at, invalidated_at,
                expires_at <= clock_timestamp() AS expired
         FROM verification_challenges
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [challengeId, user.id],
      );

      const challenge = challengeResult.rows[0];

      if (!challenge) {
        await client.query("ROLLBACK");
        return json({ message: "Verification request not found." }, 404);
      }

      if (challenge.consumed_at || challenge.invalidated_at) {
        await client.query("ROLLBACK");
        return json(
          { message: "This verification request is no longer usable." },
          409,
        );
      }

      if (challenge.expired) {
        await client.query("ROLLBACK");
        return json({ message: "This code has expired. Request a new code." }, 410);
      }

      if (challenge.attempts >= challenge.max_attempts) {
        await client.query("ROLLBACK");
        return json(
          { message: "Attempt limit reached. Request a new code." },
          429,
        );
      }

      const isEmail = challenge.purpose === "verify_email";
      const currentDestination = isEmail ? user.email : user.phone;

      if (challenge.destination !== currentDestination) {
        await client.query("ROLLBACK");
        return json({ message: "Contact details have changed." }, 409);
      }

      if (!matchesVerificationCode(challenge.id, code, challenge.code_hash)) {
        const attempts = challenge.attempts + 1;

        await client.query(
          `UPDATE verification_challenges
           SET attempts = $2
           WHERE id = $1`,
          [challenge.id, attempts],
        );

        // Commit failed attempts so they cannot be retried indefinitely.
        await client.query("COMMIT");

        const exhausted = attempts >= challenge.max_attempts;

        return json(
          {
            message: exhausted
              ? "Attempt limit reached. Request a new code."
              : "Incorrect verification code.",
            attemptsRemaining: challenge.max_attempts - attempts,
          },
          exhausted ? 429 : 400,
        );
      }

      await client.query(
        `UPDATE verification_challenges
         SET consumed_at = clock_timestamp()
         WHERE id = $1`,
        [challenge.id],
      );

      await client.query(
        `UPDATE users
         SET email_verified_at = CASE
               WHEN $2::boolean
               THEN COALESCE(email_verified_at, clock_timestamp())
               ELSE email_verified_at
             END,
             phone_verified_at = CASE
               WHEN NOT $2::boolean
               THEN COALESCE(phone_verified_at, clock_timestamp())
               ELSE phone_verified_at
             END,
             updated_at = clock_timestamp()
         WHERE id = $1`,
        [user.id, isEmail],
      );

      const updatedUser = await client.query<{
        status: string;
        email_verified: boolean;
        phone_verified: boolean;
      }>(
        `UPDATE users
         SET status = CASE
               WHEN email_verified_at IS NOT NULL
                AND phone_verified_at IS NOT NULL
               THEN 'active'
               ELSE status
             END,
             updated_at = clock_timestamp()
         WHERE id = $1
         RETURNING status,
                   email_verified_at IS NOT NULL AS email_verified,
                   phone_verified_at IS NOT NULL AS phone_verified`,
        [user.id],
      );

      await client.query("COMMIT");

      const account = updatedUser.rows[0];

      return json(
        {
          message: isEmail
            ? "Email verified successfully."
            : "Mobile number verified successfully.",
          status: account.status,
          emailVerified: account.email_verified,
          phoneVerified: account.phone_verified,
        },
        200,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch {
    console.error("Contact verification failed.");

    return json(
      { message: "Verification could not be completed. Please try again." },
      500,
    );
  }
}   