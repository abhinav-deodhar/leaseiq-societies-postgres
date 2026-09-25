import "server-only";
import { z } from "zod";
import { getDatabase } from "../db";
import { createVerificationCode } from "./verification-code";
import {
  deliverRegistrationEmail,
  registrationDeliveryMode,
} from "./registration-delivery";

export class EmailResendError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "EmailResendError";
  }
}

const schema = z.strictObject({ challengeId: z.uuid() });

export async function resendRegistrationEmail(
  input: unknown,
  sendEmail = deliverRegistrationEmail,
) {
  if (!registrationDeliveryMode()) {
    throw new EmailResendError(503, "Verification is not available.");
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new EmailResendError(400, "Provide a valid email verification request.");
  }

  const client = await getDatabase().connect();
  let challenge: ReturnType<typeof createVerificationCode>;
  let destination: string;
  let discard = false;

  try {
    await client.query("BEGIN");

    const lookup = await client.query<{ user_id: string }>(
      `SELECT user_id FROM verification_challenges
       WHERE id = $1 AND purpose = 'verify_email'`,
      [parsed.data.challengeId],
    );
    if (!lookup.rows[0]) {
      throw new EmailResendError(404, "Email verification request not found.");
    }

    // Match the verification endpoint's lock order.
    // This serializes resends across tabs and server instances.
    const users = await client.query<{
      id: string;
      email: string;
      status: string;
      email_verified_at: Date | null;
    }>(
      `SELECT id, email, status, email_verified_at
       FROM users WHERE id = $1 FOR UPDATE`,
      [lookup.rows[0].user_id],
    );

    const user = users.rows[0];
    if (!user || user.status !== "pending_verification" || user.email_verified_at) {
      throw new EmailResendError(
        409, "Email verification is no longer required or permitted.",
      );
    }

    // Permit a recently replaced handle so a lost HTTP response can recover.
    // Never take the recipient or account ID from the request.
    const reference = await client.query<{ destination: string }>(
      `SELECT destination FROM verification_challenges
       WHERE id = $1 AND user_id = $2
         AND purpose = 'verify_email' AND channel = 'email'
         AND consumed_at IS NULL
         AND created_at > clock_timestamp() - interval '24 hours'`,
      [parsed.data.challengeId, user.id],
    );
    if (reference.rows[0]?.destination !== user.email) {
      throw new EmailResendError(409, "This verification session is no longer usable.");
    }

    // Include invalidated challenges: replacing codes must not reset limits.
    const history = await client.query<{ created_at: Date }>(
      `SELECT created_at FROM verification_challenges
       WHERE user_id = $1 AND purpose = 'verify_email'
         AND created_at > clock_timestamp() - interval '1 hour'
       ORDER BY created_at DESC`,
      [user.id],
    );
    const clock = await client.query<{ now: Date }>(
      "SELECT clock_timestamp() AS now",
    );
    const now = clock.rows[0].now.getTime();
    const recent = history.rows.filter(
      (row) => row.created_at.getTime() > now - 3_600_000,
    );

    if (recent.length >= 5) {
      const retry = Math.max(1, Math.ceil(
        (recent[4].created_at.getTime() + 3_600_000 - now) / 1000,
      ));
      throw new EmailResendError(
        429, "Email code limit reached. Please try again later.", retry,
      );
    }

    if (recent[0]) {
      const retry = Math.ceil(
        (recent[0].created_at.getTime() + 60_000 - now) / 1000,
      );
      if (retry > 0) {
        throw new EmailResendError(
          429, "Please wait before requesting another email code.", retry,
        );
      }
    }

    challenge = createVerificationCode();
    const lifetime = challenge.expiresAt.getTime() - challenge.createdAt.getTime();
    challenge.createdAt = new Date(now);
    challenge.expiresAt = new Date(now + lifetime);
    destination = user.email;

    await client.query(
      `UPDATE verification_challenges
       SET invalidated_at = clock_timestamp()
       WHERE user_id = $1 AND purpose = 'verify_email'
         AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [user.id],
    );

    await client.query(
      `INSERT INTO verification_challenges
       (id, user_id, purpose, channel, destination, code_hash,
        created_at, expires_at, max_attempts)
       VALUES ($1, $2, 'verify_email', 'email', $3, $4, $5, $6, $7)`,
      [
        challenge.id, user.id, destination, challenge.codeHash,
        challenge.createdAt, challenge.expiresAt, challenge.maxAttempts,
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }

  // Release the database connection before contacting Google.
  let delivery: "accepted" | "development_console" | "unconfirmed";
  try {
    delivery = await sendEmail(destination, challenge);
  } catch {
    delivery = "unconfirmed";
  }

  return {
    message: delivery === "unconfirmed"
      ? "A new code was created, but email delivery was not confirmed. Check your inbox or request another code after the countdown."
      : delivery === "development_console"
        ? "A new email code is available in the development terminal. Use the newest code."
        : "A new email code has been sent. Check your inbox and use the newest code.",
    verification: {
      email: {
        challengeId: challenge.id,
        expiresAt: challenge.expiresAt.toISOString(),
      },
    },
    delivery: { email: delivery },
    retryAfterSeconds: 60,
  };
}
