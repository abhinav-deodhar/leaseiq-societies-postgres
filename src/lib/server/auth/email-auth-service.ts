import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { getDatabase } from "../db";
import { HttpError } from "../http";
import {
  EMAIL_AUTH_POLICY,
  emailAuthRequestSchema,
  emailAuthVerifySchema,
  emailPasswordResetSchema,
  type EmailAuthPortal,
  type EmailAuthPurpose,
} from "../../contracts/email-auth";
import {
  createVerificationCode,
  assertDevelopmentDelivery,
  matchesVerificationCode,
} from "./verification-code";
import { registrationDeliveryMode } from "./registration-delivery";
import { deliverEmailVerification } from "./gmail-delivery";
import { hashPassword } from "./password";

export class EmailAuthRateLimitError extends HttpError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, "Too many requests. Please wait before trying again.");
  }
}

type EmailCode = {
  challengeId: string;
  destination: string;
  code: string;
  expiresAt: Date;
  purpose: EmailAuthPurpose;
};
type SendCode = (input: EmailCode) => Promise<void>;

type Account = {
  id: string;
  email: string;
  fullName: string;
  credentialRevision: number;
};

type Challenge = {
  id: string;
  destination: string;
  credentialRevision: number;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
  expired: boolean;
};

export type EmailCodeRequestResult = {
  challengeId: string;
  expiresAt: string;
  retryAfterSeconds: number;
  // Invoke through the route's supported post-response mechanism.
  // Never serialize this function or execute delivery before responding.
  deliver: () => Promise<void>;
};

export type EmailCodeVerificationResult =
  | {
      kind: "login";
      token: string;
      expiresAt: string;
      user: {
        id: string;
        fullName: string;
        portal: EmailAuthPortal;
      };
    }
  | {
      kind: "reset_password";
      resetToken: string;
      expiresAt: string;
    };

const eligible = `
  u.status = 'active'
  AND u.email_verified_at IS NOT NULL
  AND (
    u.phone_verified_at IS NOT NULL
    OR u.verification_policy = 'email_only'
  )
  AND NOT EXISTS (
    SELECT 1 FROM platform_admins p WHERE p.user_id = u.id
  )
`;

function rejectedCode() {
  return new HttpError(
    400,
    "This code is incorrect, expired, or no longer usable. Check the latest email or request another code.",
  );
}

function rejectedReset() {
  return new HttpError(
    400,
    "This password-reset session is expired or no longer usable. Request a new code.",
  );
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function limitKey(scope: "request" | "verify", email: string): string {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error("Email authentication secret is not configured.");
  }
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(JSON.stringify(["leaseiq-email-auth-v1", scope, email]))
    .digest("hex");
}

async function transaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getDatabase().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
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
}

// Committed separately: unsuccessful authentication must not undo limits.
// Keys are shared across purposes and portals for the same email address.
async function reserveAttempt(
  scope: "request" | "verify",
  email: string,
): Promise<void> {
  const key = limitKey(scope, email);
  const maximum = scope === "request"
    ? EMAIL_AUTH_POLICY.maxRequestsPerHour
    : 10;
  const windowSeconds = scope === "request" ? 3600 : 900;
  const cooldownSeconds = scope === "request"
    ? EMAIL_AUTH_POLICY.resendCooldownSeconds
    : 0;

  await transaction(async client => {
    const inserted = await client.query(
      `INSERT INTO email_auth_limits (
         key_hash, scope, attempts, window_started_at,
         expires_at, last_attempt_at
       )
       VALUES (
         $1, $2, 1, clock_timestamp(),
         clock_timestamp() + ($3::integer * interval '1 second'),
         clock_timestamp()
       )
       ON CONFLICT (key_hash) DO NOTHING
       RETURNING key_hash`,
      [key, scope, windowSeconds],
    );
    if (inserted.rowCount === 1) return;

    const result = await client.query<{
      attempts: number;
      expiresAt: Date;
      lastAttemptAt: Date;
    }>(
      `SELECT attempts, expires_at AS "expiresAt",
              last_attempt_at AS "lastAttemptAt"
       FROM email_auth_limits WHERE key_hash = $1 FOR UPDATE`,
      [key],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Authentication limit unavailable.");

    const clock = await client.query<{ now: Date }>(
      "SELECT clock_timestamp() AS now",
    );
    const now = clock.rows[0].now.getTime();

    if (row.expiresAt.getTime() <= now) {
      await client.query(
        `UPDATE email_auth_limits SET
           attempts = 1,
           window_started_at = clock_timestamp(),
           last_attempt_at = clock_timestamp(),
           expires_at = clock_timestamp() +
             ($2::integer * interval '1 second')
         WHERE key_hash = $1`,
        [key, windowSeconds],
      );
      return;
    }

    if (row.attempts >= maximum) {
      throw new EmailAuthRateLimitError(Math.max(
        1, Math.ceil((row.expiresAt.getTime() - now) / 1000),
      ));
    }

    const cooldown = Math.ceil(
      (row.lastAttemptAt.getTime() + cooldownSeconds * 1000 - now) / 1000,
    );
    if (cooldown > 0) throw new EmailAuthRateLimitError(cooldown);

    await client.query(
      `UPDATE email_auth_limits
       SET attempts = attempts + 1, last_attempt_at = clock_timestamp()
       WHERE key_hash = $1`,
      [key],
    );
  });
}

async function lockAccount(
  client: PoolClient,
  userId: string,
): Promise<Account | undefined> {
  const result = await client.query<Account>(
    `SELECT u.id, u.email, u.full_name AS "fullName",
            u.credential_revision AS "credentialRevision"
     FROM users u
     WHERE u.id = $1 AND ${eligible}
     FOR UPDATE OF u`,
    [userId],
  );
  return result.rows[0];
}

async function sendEmailCode(input: EmailCode): Promise<void> {
  const mode = registrationDeliveryMode();
  if (mode === "console") {
    assertDevelopmentDelivery();
    console.info(
      `[DEV EMAIL AUTH] ${input.purpose} | request=${input.challengeId} | code=${input.code}`,
    );
    return;
  }
  if (mode !== "gmail") {
    throw new Error("Email authentication delivery unavailable.");
  }
  await deliverEmailVerification(input);
}

export async function requestEmailCode(
  input: unknown,
  send: SendCode = sendEmailCode,
): Promise<EmailCodeRequestResult> {
  const parsed = emailAuthRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(
      400, parsed.error.issues[0]?.message ?? "Check your email address.",
    );
  }
  if (send === sendEmailCode && !registrationDeliveryMode()) {
    throw new HttpError(503, "Email authentication is not configured.");
  }

  const next = parsed.data;
  await reserveAttempt("request", next.email);

  // Generate the same response shape even for an unknown/ineligible account.
  const challenge = createVerificationCode();
  const destination = await transaction(async client => {
    const result = await client.query<Account>(
      `SELECT u.id, u.email, u.full_name AS "fullName",
              u.credential_revision AS "credentialRevision"
       FROM users u
       WHERE u.email = $1 AND ${eligible}
       FOR UPDATE OF u`,
      [next.email],
    );
    const user = result.rows[0];
    if (!user) return null;

    const clock = await client.query<{ now: Date }>(
      "SELECT clock_timestamp() AS now",
    );
    challenge.createdAt = clock.rows[0].now;
    challenge.expiresAt = new Date(
      challenge.createdAt.getTime() +
      EMAIL_AUTH_POLICY.codeLifetimeSeconds * 1000,
    );

    await client.query(
      `UPDATE email_auth_challenges
       SET invalidated_at = clock_timestamp()
       WHERE user_id = $1 AND portal = $2 AND purpose = $3
         AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [user.id, next.portal, next.purpose],
    );
    await client.query(
      `INSERT INTO email_auth_challenges (
         id, user_id, portal, purpose, destination,
         credential_revision, code_hash, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        challenge.id, user.id, next.portal, next.purpose, user.email,
        user.credentialRevision, challenge.codeHash,
        challenge.createdAt, challenge.expiresAt,
      ],
    );
    return user.email;
  });

  let started = false;
  return {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt.toISOString(),
    retryAfterSeconds: EMAIL_AUTH_POLICY.resendCooldownSeconds,
    deliver: async () => {
      if (started) return;
      started = true;
      if (!destination) return;
      try {
        await send({
          challengeId: challenge.id,
          destination,
          code: challenge.code,
          expiresAt: challenge.expiresAt,
          purpose: next.purpose,
        });
      } catch {
        // Provider acceptance may be uncertain; never send an automatic duplicate.
        // No codes, destinations or provider responses in this log.
        console.error("Email authentication delivery was not confirmed.");
      }
    },
  };
}

export async function verifyEmailCode(
  input: unknown,
): Promise<EmailCodeVerificationResult> {
  const parsed = emailAuthVerifySchema.safeParse(input);
  if (!parsed.success) throw rejectedCode();
  const next = parsed.data;

  const lookup = await getDatabase().query<{ userId: string; email: string }>(
    `SELECT c.user_id AS "userId", u.email
     FROM email_auth_challenges c JOIN users u ON u.id = c.user_id
     WHERE c.id = $1 AND c.portal = $2 AND c.purpose = $3`,
    [next.challengeId, next.portal, next.purpose],
  );
  const reference = lookup.rows[0];
  if (!reference) throw rejectedCode();

  await reserveAttempt("verify", reference.email);

  const result = await transaction<EmailCodeVerificationResult | HttpError>(
    async client => {
      const user = await lockAccount(client, reference.userId);
      if (!user) return rejectedCode();

      const rows = await client.query<Challenge>(
        `SELECT id, destination,
                credential_revision AS "credentialRevision",
                code_hash AS "codeHash", attempts,
                max_attempts AS "maxAttempts",
                consumed_at AS "consumedAt",
                invalidated_at AS "invalidatedAt",
                expires_at <= clock_timestamp() AS expired
         FROM email_auth_challenges
         WHERE id = $1 AND user_id = $2 AND portal = $3 AND purpose = $4
         FOR UPDATE`,
        [next.challengeId, user.id, next.portal, next.purpose],
      );
      const challenge = rows.rows[0];
      if (
        !challenge || challenge.consumedAt || challenge.invalidatedAt ||
        challenge.expired || challenge.attempts >= challenge.maxAttempts ||
        challenge.destination !== user.email ||
        challenge.credentialRevision !== user.credentialRevision
      ) return rejectedCode();

      if (!matchesVerificationCode(
        challenge.id, next.code, challenge.codeHash,
      )) {
        await client.query(
          `UPDATE email_auth_challenges
           SET attempts = attempts + 1 WHERE id = $1`,
          [challenge.id],
        );
        // Return the error so the transaction commits the failed attempt.
        return rejectedCode();
      }

      await client.query(
        `UPDATE email_auth_challenges
         SET consumed_at = clock_timestamp() WHERE id = $1`,
        [challenge.id],
      );

      const token = randomBytes(32).toString("hex");
      if (next.purpose === "reset_password") {
        const grant = await client.query<{ expiresAt: Date }>(
          `INSERT INTO email_password_reset_grants (
             token_hash, challenge_id, user_id, portal,
             credential_revision, expires_at
           )
           VALUES (
             $1,$2,$3,$4,$5,
             clock_timestamp() + ($6::integer * interval '1 second')
           )
           RETURNING expires_at AS "expiresAt"`,
          [
            tokenHash(token), challenge.id, user.id, next.portal,
            user.credentialRevision, EMAIL_AUTH_POLICY.resetLifetimeSeconds,
          ],
        );
        return {
          kind: "reset_password",
          resetToken: token,
          expiresAt: grant.rows[0].expiresAt.toISOString(),
        };
      }

      const session = await client.query<{ expiresAt: Date }>(
        `INSERT INTO auth_sessions (user_id, token_hash, portal, expires_at)
         VALUES ($1,$2,$3,clock_timestamp() + interval '8 hours')
         RETURNING expires_at AS "expiresAt"`,
        [user.id, tokenHash(token), next.portal],
      );
      await client.query(
        `INSERT INTO email_auth_events (
           user_id, portal, event_type, credential_revision
         ) VALUES ($1,$2,'email_login',$3)`,
        [user.id, next.portal, user.credentialRevision],
      );
      return {
        kind: "login",
        token,
        expiresAt: session.rows[0].expiresAt.toISOString(),
        user: { id: user.id, fullName: user.fullName, portal: next.portal },
      };
    },
  );

  if (result instanceof HttpError) throw result;
  return result;
}

export async function resetEmailPassword(input: unknown): Promise<void> {
  const parsed = emailPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(
      400, parsed.error.issues[0]?.message ?? "Check your new password.",
    );
  }
  const next = parsed.data;
  const hash = tokenHash(next.resetToken);
  const lookup = await getDatabase().query<{ userId: string }>(
    `SELECT user_id AS "userId"
     FROM email_password_reset_grants
     WHERE token_hash = $1 AND portal = $2`,
    [hash, next.portal],
  );
  const reference = lookup.rows[0];
  if (!reference) throw rejectedReset();

  await transaction(async client => {
    const user = await lockAccount(client, reference.userId);
    if (!user) throw rejectedReset();

    const grants = await client.query<{
      credentialRevision: number;
      consumedAt: Date | null;
      invalidatedAt: Date | null;
      expired: boolean;
      destination: string;
      purpose: string;
    }>(
      `SELECT g.credential_revision AS "credentialRevision",
              g.consumed_at AS "consumedAt",
              g.invalidated_at AS "invalidatedAt",
              g.expires_at <= clock_timestamp() AS expired,
              c.destination, c.purpose
       FROM email_password_reset_grants g
       JOIN email_auth_challenges c ON c.id = g.challenge_id
       WHERE g.token_hash = $1 AND g.user_id = $2 AND g.portal = $3
       FOR UPDATE OF g`,
      [hash, user.id, next.portal],
    );
    const grant = grants.rows[0];
    if (
      !grant || grant.consumedAt || grant.invalidatedAt || grant.expired ||
      grant.credentialRevision !== user.credentialRevision ||
      grant.destination !== user.email || grant.purpose !== "reset_password"
    ) throw rejectedReset();

    // Only a valid reset grant can trigger password hashing.
    const passwordHash = await hashPassword(next.newPassword);

    // Recheck expiry after hashing before making any credential changes.
    const consumed = await client.query(
      `UPDATE email_password_reset_grants
       SET consumed_at = clock_timestamp()
       WHERE token_hash = $1 AND expires_at > clock_timestamp()
         AND consumed_at IS NULL AND invalidated_at IS NULL
       RETURNING token_hash`,
      [hash],
    );
    if (consumed.rowCount !== 1) throw rejectedReset();

    const changed = await client.query<{ revision: number }>(
      `UPDATE users
       SET password_hash = $2,
           credential_revision = credential_revision + 1,
           updated_at = clock_timestamp()
       WHERE id = $1
       RETURNING credential_revision AS revision`,
      [user.id, passwordHash],
    );

    // Revoke the parent families as well as all browser/mobile access tokens.
    await client.query(
      `UPDATE mobile_sessions
       SET revoked_at = clock_timestamp(), revocation_reason = 'password_reset'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    await client.query(
      `UPDATE auth_sessions SET revoked_at = clock_timestamp()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );

    await client.query(
      `UPDATE email_auth_challenges SET invalidated_at = clock_timestamp()
       WHERE user_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [user.id],
    );
    await client.query(
      `UPDATE email_password_reset_grants
       SET invalidated_at = clock_timestamp()
       WHERE user_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [user.id],
    );
    await client.query(
      `UPDATE verification_challenges SET invalidated_at = clock_timestamp()
       WHERE user_id = $1 AND purpose IN ('login_phone', 'reset_password')
         AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [user.id],
    );
    await client.query(
      `INSERT INTO email_auth_events (
         user_id, portal, event_type, credential_revision
       ) VALUES ($1,$2,'password_reset',$3)`,
      [user.id, next.portal, changed.rows[0].revision],
    );
  });
}
