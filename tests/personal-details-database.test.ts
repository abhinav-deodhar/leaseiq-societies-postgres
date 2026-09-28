import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { getDatabase } from "../src/lib/server/db";
import { hashPassword } from "../src/lib/server/auth/password";
import { HttpError } from "../src/lib/server/http";
import {
  getPersonalDetails, savePersonalDetails,
} from "../src/lib/server/services/personal-details.service";

const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as typeof import("@next/env");
const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.status === code;

test("personal details require authorised corrections and preserve concurrent edits", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""));
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  const db = getDatabase();
  const user = randomUUID();
  const other = randomUUID();
  const ids = [user, other];
  const password = "PersonalDetails-Test!2026";
  const hash = await hashPassword(password);

  try {
    for (const id of ids) {
      await db.query(
        `INSERT INTO users (
           id, full_name, email, phone, date_of_birth, password_hash,
           status, email_verified_at, phone_verified_at
         ) VALUES ($1, 'Original Name', $2, $3, '1990-01-01', $4,
                   'active', now(), now())`,
        [id, `personal-${id}@example.invalid`,
         `+919${randomInt(100000000, 1000000000)}`, hash],
      );
    }

    const input = {
      fullName: "Original Name", preferredName: "  Friend  ",
      dateOfBirth: "1990-01-01", expectedRevision: 0,
    };

    const preferred = await savePersonalDetails(user, input);
    assert.equal(preferred.preferredName, "Friend");
    assert.equal(preferred.revision, 1);
    assert.equal((await getPersonalDetails(other)).preferredName, null);

    const correction = {
      ...input, fullName: "Corrected Name",
      preferredName: "Friend", dateOfBirth: "1991-02-03",
      expectedRevision: 1,
    };

    await assert.rejects(savePersonalDetails(user, correction), status(400));
    await assert.rejects(savePersonalDetails(user, {
      ...correction, currentPassword: "incorrect",
    }), status(403));
    assert.equal((await getPersonalDetails(user)).fullName, "Original Name");

    const corrected = await savePersonalDetails(user, {
      ...correction, currentPassword: password,
    });
    assert.equal(corrected.fullName, "Corrected Name");
    assert.equal(corrected.dateOfBirth, "1991-02-03");
    assert.equal(corrected.revision, 2);

    await assert.rejects(savePersonalDetails(user, correction), status(409));
    await assert.rejects(savePersonalDetails(user, {
      ...correction, expectedRevision: 2, dateOfBirth: null,
    }), status(400));
    await assert.rejects(savePersonalDetails(user, {
      ...correction, expectedRevision: 2, userId: other,
    }), status(400));

    const race = await Promise.allSettled(["First", "Second"].map(preferredName =>
      savePersonalDetails(user, {
        ...correction, expectedRevision: 2, preferredName,
      }),
    ));
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await getPersonalDetails(user)).revision, 3);

    const audit = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM personal_details_events WHERE user_id=$1`,
      [user],
    );
    assert.equal(audit.rows[0].count, 3);

    await db.query("UPDATE users SET status='disabled' WHERE id=$1", [other]);
    await assert.rejects(getPersonalDetails(other), status(401));
  } finally {
    await db.query("DELETE FROM personal_details_events WHERE user_id=ANY($1::uuid[])", [ids]);
    await db.query("DELETE FROM personal_details_auth_attempts WHERE user_id=ANY($1::uuid[])", [ids]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await db.end();
  }
});
