import "server-only";
import { getDatabase } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { verifyPassword } from "@/lib/server/auth/password";
import {
  personalDetailsSchema, changedPersonalFields, type PersonalDetails,
} from "@/lib/contracts/personal-details";

const columns = `
  full_name AS "fullName",
  preferred_name AS "preferredName",
  date_of_birth::text AS "dateOfBirth",
  personal_details_revision AS revision
`;

const eligible = `
  status = 'active'
  AND email_verified_at IS NOT NULL
  AND (phone_verified_at IS NOT NULL OR verification_policy = 'email_only')
  AND NOT EXISTS (
    SELECT 1 FROM platform_admins p WHERE p.user_id = users.id
  )
`;

type AccountRow = PersonalDetails & { passwordHash: string | null };

export async function getPersonalDetails(userId: string): Promise<PersonalDetails> {
  const result = await getDatabase().query<PersonalDetails>(
    `SELECT ${columns} FROM users WHERE id = $1 AND ${eligible}`,
    [userId],
  );
  if (!result.rows[0]) throw new HttpError(401, "Sign in again to view your details.");
  return result.rows[0];
}

export async function savePersonalDetails(
  userId: string, input: unknown,
): Promise<PersonalDetails> {
  const parsed = personalDetailsSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check your details.");
  }

  const next = parsed.data;
  const before = (await getDatabase().query<AccountRow>(
    `SELECT ${columns}, password_hash AS "passwordHash"
     FROM users WHERE id = $1 AND ${eligible}`,
    [userId],
  )).rows[0];

  if (!before) throw new HttpError(401, "Sign in again to update your details.");
  if (before.revision !== next.expectedRevision) {
    throw new HttpError(409, "Your details changed in another session. Reload before saving.");
  }
  if (before.dateOfBirth && !next.dateOfBirth) {
    throw new HttpError(400, "Enter your date of birth; it cannot be removed.");
  }

  const changed = changedPersonalFields(before, next);
  const sensitive = changed.includes("fullName") || changed.includes("dateOfBirth");

  if (sensitive) {
    if (!next.currentPassword) {
      throw new HttpError(400, "Enter your current password to confirm this correction.");
    }

    // Committed separately so failed password attempts still count.
    const attempts = await getDatabase().query<{ attempts: number }>(
      `INSERT INTO personal_details_auth_attempts(user_id) VALUES ($1)
       ON CONFLICT(user_id) DO UPDATE SET
         attempts = CASE
           WHEN personal_details_auth_attempts.window_start < now() - interval '15 minutes'
           THEN 1 ELSE personal_details_auth_attempts.attempts + 1 END,
         window_start = CASE
           WHEN personal_details_auth_attempts.window_start < now() - interval '15 minutes'
           THEN now() ELSE personal_details_auth_attempts.window_start END
       RETURNING attempts`,
      [userId],
    );

    if (attempts.rows[0].attempts > 5) {
      throw new HttpError(429, "Too many password checks. Try again in 15 minutes.");
    }
    if (!before.passwordHash ||
        !await verifyPassword(next.currentPassword, before.passwordHash)) {
      throw new HttpError(403, "The current password is incorrect.");
    }
  }

  const client = await getDatabase().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '5s'");

    const current = (await client.query<AccountRow>(
      `SELECT ${columns}, password_hash AS "passwordHash"
       FROM users WHERE id = $1 AND ${eligible} FOR UPDATE`,
      [userId],
    )).rows[0];

    if (!current) throw new HttpError(401, "Sign in again to update your details.");
    if (
      current.revision !== before.revision ||
      changedPersonalFields(before, current).length ||
      (sensitive && current.passwordHash !== before.passwordHash)
    ) {
      throw new HttpError(409, "Your account changed while saving. Reload before continuing.");
    }

    if (!changed.length) {
      await client.query("COMMIT");
      return {
        fullName: current.fullName,
        preferredName: current.preferredName,
        dateOfBirth: current.dateOfBirth,
        revision: current.revision,
      };
    }

    const updated = await client.query<PersonalDetails>(
      `UPDATE users SET
         full_name = $2, preferred_name = $3, date_of_birth = $4,
         personal_details_revision = personal_details_revision + 1,
         updated_at = clock_timestamp()
       WHERE id = $1 RETURNING ${columns}`,
      [userId, next.fullName, next.preferredName, next.dateOfBirth],
    );

    await client.query(
      `INSERT INTO personal_details_events(user_id, revision, changed_fields)
       VALUES ($1, $2, $3::text[])`,
      [userId, updated.rows[0].revision, changed],
    );

    // Application snapshots and flat memberships are deliberately untouched.
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}
