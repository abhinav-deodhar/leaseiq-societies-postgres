import {
  deliverRegistrationCodes,
  registrationDeliveryMode,
} from "@/lib/server/auth/registration-delivery";
import { checkRequestOrigin, HttpError } from "@/lib/server/http";
import { registrationSchema } from "@/lib/validation/auth";
import { getDatabase } from "@/lib/server/db";
import { hashPassword } from "@/lib/server/auth/password";
import {
  createVerificationCode,
} from "@/lib/server/auth/verification-code";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8192;

class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    throw new RequestBodyError("Send the request as application/json.", 415);
  }

  if (!request.body) {
    throw new RequestBodyError("Request body is required.", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestBodyError("Request body is too large.", 413);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestBodyError("Request body must contain valid JSON.", 400);
  }
}

export async function POST(request: Request) {
  if (!registrationDeliveryMode()) {
    return json({ message: "Registration is not available." }, 503);
  }

  try {
    checkRequestOrigin(request);
    const body = await readJsonBody(request);
    const validation = registrationSchema.safeParse(body);

    if (!validation.success) {
      return json(
        {
          message: "Please correct the highlighted fields.",
          errors: validation.error.issues.map((issue) => ({
            field: issue.path.join(".") || "form",
            message: issue.message,
          })),
        },
        400,
      );
    }

    const { fullName, dateOfBirth, email, phone, password } =
      validation.data;    
      const passwordHash = await hashPassword(password);

    const client = await getDatabase().connect();

    let userId: string;
    let emailChallenge: ReturnType<typeof createVerificationCode>;
    let phoneChallenge: ReturnType<typeof createVerificationCode>;

    try {
      await client.query("BEGIN");

      const result = await client.query<{ id: string }>(
        `INSERT INTO users (full_name, email, phone, password_hash, date_of_birth)
         VALUES ($1, $2, $3, $4, $5::date)
         RETURNING id`,
        [fullName, email, phone, passwordHash, dateOfBirth],
      );

      userId = result.rows[0].id;

      emailChallenge = createVerificationCode();
      phoneChallenge = createVerificationCode();

      for (const item of [
        {
          challenge: emailChallenge,
          purpose: "verify_email",
          channel: "email",
          destination: email,
        },
        {
          challenge: phoneChallenge,
          purpose: "verify_phone",
          channel: "sms",
          destination: phone,
        },
      ]) {
        await client.query(
          `INSERT INTO verification_challenges (
             id,
             user_id,
             purpose,
             channel,
             destination,
             code_hash,
             created_at,
             expires_at,
             max_attempts
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            item.challenge.id,
            userId,
            item.purpose,
            item.channel,
            item.destination,
            item.challenge.codeHash,
            item.challenge.createdAt,
            item.challenge.expiresAt,
            item.challenge.maxAttempts,
          ],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const delivery = await deliverRegistrationCodes(
      email,
      emailChallenge,
      phoneChallenge,
    );

    return json(
      {
        message: delivery.email === "unconfirmed"
          ? "Your account was created, but email delivery was not confirmed. Keep this verification page open."
          : "Account created. Verify your email and mobile number.",
        delivery,
        userId,
        status: "pending_verification",
        verification: {
          email: {
            challengeId: emailChallenge.id,
            expiresAt: emailChallenge.expiresAt.toISOString(),
          },
          phone: {
            challengeId: phoneChallenge.id,
            expiresAt: phoneChallenge.expiresAt.toISOString(),
          },
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ message: error.message }, error.status);
    }

    if (error instanceof RequestBodyError) {
      return json({ message: error.message }, error.status);
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return json(
        {
          message:
            "An account already uses these contact details. Sign in or continue verification.",
        },
        409,
      );
    }

    console.error("Registration could not be completed.");

    return json(
      { message: "Registration could not be completed. Please try again." },
      500,
    );
  }
}