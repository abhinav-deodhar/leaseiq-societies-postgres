import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getDatabase } from "../src/lib/server/db";
import {
  reviewApplication,
} from "../src/lib/server/services/application-decision.service";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import(
  "@next/env"
);

test("chairman approval and membership", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");

  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(
      process.env.PGHOST ?? "",
    ),
    "This test requires a local database.",
  );
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  const pool = getDatabase();
  const userIds: string[] = [];
  const societyIds: string[] = [];

  async function createUser(): Promise<string> {
    const id = randomUUID();

    await pool.query(
      `INSERT INTO users (
         id, full_name, email, phone, date_of_birth,
         status, email_verified_at, phone_verified_at
       )
       VALUES (
         $1, 'Approval Test', $2, $3, '1990-01-01',
         'active', clock_timestamp(), clock_timestamp()
       )`,
      [
        id,
        `approval-${id}@example.invalid`,
        `+919${randomInt(100_000_000, 1_000_000_000)}`,
      ],
    );

    userIds.push(id);
    return id;
  }

  async function createApplication(chairmanId: string) {
    const societyId = randomUUID();
    const applicationId = randomUUID();

    await pool.query(
      `INSERT INTO societies (
         id, name, address_line_1, city, state_or_union_territory,
         pin_code, wing_count, total_units, one_bhk_units, created_by
       )
       VALUES (
         $1, 'Approval Test Society', 'Test Street 123',
         'Pune', 'Maharashtra', '411001', 1, 1, 1, $2
       )`,
      [societyId, chairmanId],
    );

    societyIds.push(societyId);

    await pool.query(
      `INSERT INTO society_memberships (
         society_id, user_id, role, status
       )
       VALUES ($1, $2, 'chairman', 'pending')`,
      [societyId, chairmanId],
    );

    await pool.query(
      `INSERT INTO society_applications (
         id, society_id, applicant_user_id, status, submitted_at
       )
       VALUES ($1, $2, $3, 'pending_review', clock_timestamp())`,
      [applicationId, societyId, chairmanId],
    );

    await pool.query(
      `INSERT INTO application_events (
         application_id, actor_user_id, action,
         application_revision, application_snapshot
       )
       VALUES ($1, $2, 'submitted', 1, $3::jsonb)`,
      [
        applicationId,
        chairmanId,
        JSON.stringify({
          society: { name: "Approval Test Society" },
          applicant: { userId: chairmanId },
        }),
      ],
    );

    return { societyId, applicationId };
  }

  async function readStatus(applicationId: string) {
    const result = await pool.query<{
      applicationStatus: string;
      membershipStatus: string | null;
      serviceStatus: string;
      eventCount: number;
    }>(
      `SELECT
         a.status AS "applicationStatus",
         m.status AS "membershipStatus",
         s.service_status AS "serviceStatus",
         (
           SELECT COUNT(*)::integer
           FROM application_events e
           WHERE e.application_id = a.id
         ) AS "eventCount"
       FROM society_applications a
       JOIN societies s ON s.id = a.society_id
       LEFT JOIN society_memberships m
         ON m.society_id = a.society_id
         AND m.user_id = a.applicant_user_id
         AND m.role = 'chairman'
       WHERE a.id = $1`,
      [applicationId],
    );

    assert.equal(result.rowCount, 1);
    return result.rows[0];
  }

  try {
    const chairmanId = await createUser();
    const adminId = await createUser();

    await pool.query(
      "INSERT INTO platform_admins (user_id) VALUES ($1)",
      [adminId],
    );

    await t.test("approval grants role without activating services", async () => {
      const fixture = await createApplication(chairmanId);

      await reviewApplication(adminId, fixture.applicationId, {
        decision: "approved",
        expectedStatus: "pending_review",
        expectedRevision: 1,
        note: "Approved for testing.",
      });

      assert.deepEqual(await readStatus(fixture.applicationId), {
        applicationStatus: "approved",
        membershipStatus: "active",
        serviceStatus: "inactive",
        eventCount: 2,
      });

      await assert.rejects(
        reviewApplication(adminId, fixture.applicationId, {
          decision: "approved",
          expectedStatus: "pending_review",
          expectedRevision: 1,
          note: "Duplicate decision.",
        }),
        { code: "CONFLICT" },
      );

      assert.equal(
        (await readStatus(fixture.applicationId)).eventCount,
        2,
      );
    });

    await t.test("changes requested stay pending; rejection revokes role", async () => {
      const fixture = await createApplication(chairmanId);

      await reviewApplication(adminId, fixture.applicationId, {
        decision: "changes_requested",
        expectedStatus: "pending_review",
        expectedRevision: 1,
        note: "Please correct the address.",
      });

      assert.deepEqual(await readStatus(fixture.applicationId), {
        applicationStatus: "changes_requested",
        membershipStatus: "pending",
        serviceStatus: "inactive",
        eventCount: 2,
      });

      await reviewApplication(adminId, fixture.applicationId, {
        decision: "rejected",
        expectedStatus: "changes_requested",
        expectedRevision: 1,
        note: "Application rejected for testing.",
      });

      assert.deepEqual(await readStatus(fixture.applicationId), {
        applicationStatus: "rejected",
        membershipStatus: "revoked",
        serviceStatus: "inactive",
        eventCount: 3,
      });
    });

    await t.test("non-admin cannot approve an application", async () => {
      const fixture = await createApplication(chairmanId);

      await assert.rejects(
        reviewApplication(chairmanId, fixture.applicationId, {
          decision: "approved",
          expectedStatus: "pending_review",
          expectedRevision: 1,
          note: "Not authorized.",
        }),
        { code: "FORBIDDEN" },
      );

      assert.deepEqual(await readStatus(fixture.applicationId), {
        applicationStatus: "pending_review",
        membershipStatus: "pending",
        serviceStatus: "inactive",
        eventCount: 1,
      });
    });

    await t.test("membership failure rolls back the approval", async () => {
      const fixture = await createApplication(chairmanId);

      await pool.query(
        `DELETE FROM society_memberships
         WHERE society_id = $1 AND user_id = $2`,
        [fixture.societyId, chairmanId],
      );

      await assert.rejects(
        reviewApplication(adminId, fixture.applicationId, {
          decision: "approved",
          expectedStatus: "pending_review",
          expectedRevision: 1,
          note: "Must roll back.",
        }),
        { message: "The application's pending chairman membership is missing." },
      );

      assert.deepEqual(await readStatus(fixture.applicationId), {
        applicationStatus: "pending_review",
        membershipStatus: null,
        serviceStatus: "inactive",
        eventCount: 1,
      });
    });
  } finally {
    try {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await client.query(
          `DELETE FROM application_events
           WHERE application_id IN (
             SELECT id FROM society_applications
             WHERE society_id = ANY($1::uuid[])
           )`,
          [societyIds],
        );
        await client.query(
          "DELETE FROM society_applications WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM society_memberships WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM societies WHERE id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM platform_admins WHERE user_id = ANY($1::uuid[])",
          [userIds],
        );
        await client.query(
          "DELETE FROM users WHERE id = ANY($1::uuid[])",
          [userIds],
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  }
});
