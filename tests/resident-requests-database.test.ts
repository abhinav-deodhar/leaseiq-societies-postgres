import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getDatabase } from "../src/lib/server/db";
import {
  createResidentRequestDraft,
  updateResidentRequestDraft,
  ResidentRequestError,
} from "../src/lib/server/services/resident-requests.service";

import {
  authoriseResidentDocumentRead,
  ResidentDocumentAccessError,
} from "../src/lib/server/services/resident-document-access.service";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import("@next/env");

function hasCode(code: ResidentRequestError["code"]) {
  return (error: unknown): boolean =>
    error instanceof ResidentRequestError && error.code === code;
}

test("resident draft database behaviour", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""),
    "Run only against local PostgreSQL.",
  );
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  const pool = getDatabase();
  const applicant = randomUUID();
  const otherUser = randomUUID();
  const admin = randomUUID();
  const users = [applicant, otherUser, admin];
  const society = randomUUID();
  const otherSociety = randomUUID();
  const societies = [society, otherSociety];
  const unit = randomUUID();
  const secondUnit = randomUUID();
  const foreignUnit = randomUUID();

  const setup = await pool.connect();
  let installed = false;

  try {
    await setup.query("BEGIN");

    for (const userId of users) {
      await setup.query(
        `INSERT INTO users (
           id, full_name, email, phone, date_of_birth,
           status, email_verified_at, phone_verified_at
         ) VALUES (
           $1, 'Resident Test Account', $2, $3, '1990-01-01',
           'active', clock_timestamp(), clock_timestamp()
         )`,
        [
          userId,
          `resident-test-${userId}@example.invalid`,
          `+919${randomInt(100_000_000, 1_000_000_000)}`,
        ],
      );
    }

    await setup.query(
      "INSERT INTO platform_admins (user_id) VALUES ($1)",
      [admin],
    );

    for (const societyId of societies) {
      await setup.query(
        `INSERT INTO societies (
           id, name, address_line_1, city, state_or_union_territory,
           pin_code, wing_count, total_units, one_bhk_units,
           service_status, created_by
         ) VALUES (
           $1, 'Resident Test Society', '10 Test Street',
           'Mumbai', 'Maharashtra', '400001', 1, 2, 2,
           'inactive', $2
         )`,
        [societyId, applicant],
      );

      await setup.query(
        `INSERT INTO society_applications (
           society_id, applicant_user_id, status,
           submitted_at, reviewed_at, reviewed_by
         ) VALUES (
           $1, $2, 'approved',
           clock_timestamp(), clock_timestamp(), $3
         )`,
        [societyId, applicant, admin],
      );
    }

    for (const [unitId, societyId, number] of [
      [unit, society, "T101"],
      [secondUnit, society, "T102"],
      [foreignUnit, otherSociety, "T201"],
    ]) {
      await setup.query(
        `INSERT INTO society_units (
           id, society_id, wing, flat_number, created_by
         ) VALUES ($1, $2, 'Test', $3, $4)`,
        [unitId, societyId, number, applicant],
      );
    }

    await setup.query("COMMIT");
    installed = true;
  } catch (error) {
    await setup.query("ROLLBACK");
    throw error;
  } finally {
    setup.release();
    if (!installed) await pool.end();
  }

  try {
    const input = { unitId: unit, relationship: "owner" };
    const draft = await createResidentRequestDraft(applicant, society, input);

    await t.test("saving creates a draft and audit event but no membership", async () => {
      assert.equal(draft.status, "draft");
      assert.equal(draft.revision, 1);
      assert.equal(draft.societyId, society);

      const events = await pool.query(
        `SELECT action, request_revision
         FROM resident_unit_request_events WHERE request_id = $1`,
        [draft.id],
      );
      assert.deepEqual(events.rows, [
        { action: "created", request_revision: 1 },
      ]);

      const memberships = await pool.query(
        "SELECT id FROM resident_unit_memberships WHERE user_id = $1",
        [applicant],
      );
      assert.equal(memberships.rowCount, 0);
    });

    await t.test("identical creation retry returns the existing draft", async () => {
      const retried = await createResidentRequestDraft(applicant, society, input);
      assert.equal(retried.id, draft.id);

      const events = await pool.query(
        "SELECT id FROM resident_unit_request_events WHERE request_id = $1",
        [draft.id],
      );
      assert.equal(events.rowCount, 1);
    });

    await t.test("simultaneous identical requests create one draft", async () => {
      const payload = { unitId: secondUnit, relationship: "tenant" };
      const [first, second] = await Promise.all([
        createResidentRequestDraft(applicant, society, payload),
        createResidentRequestDraft(applicant, society, payload),
      ]);

      assert.equal(first.id, second.id);
      const stored = await pool.query(
        `SELECT id FROM resident_unit_requests
         WHERE user_id = $1 AND unit_id = $2`,
        [applicant, secondUnit],
      );
      assert.equal(stored.rowCount, 1);
    });

    await t.test("a competing owner or tenant request is rejected", async () => {
      await assert.rejects(
        createResidentRequestDraft(applicant, society, {
          ...input,
          relationship: "tenant",
        }),
        hasCode("REQUEST_EXISTS"),
      );
    });

    await t.test("another resident cannot edit the applicant's draft", async () => {
      await assert.rejects(
        updateResidentRequestDraft(
          otherUser, society, draft.id, 1, input,
        ),
        hasCode("NOT_FOUND"),
      );
    });

    await t.test("cross-society flat and request references are rejected", async () => {
      await assert.rejects(
        createResidentRequestDraft(applicant, society, {
          unitId: foreignUnit,
          relationship: "owner",
        }),
        hasCode("NOT_FOUND"),
      );
      await assert.rejects(
        updateResidentRequestDraft(
          applicant, otherSociety, draft.id, 1, input,
        ),
        hasCode("NOT_FOUND"),
      );
    });

    await t.test("editing cannot move a request to another flat", async () => {
      await assert.rejects(
        updateResidentRequestDraft(
          applicant, society, draft.id, 1,
          { unitId: secondUnit, relationship: "owner" },
        ),
        hasCode("INVALID_INPUT"),
      );
    });

    await t.test("saving updates the revision; stale saves cannot overwrite it", async () => {
      const updated = await updateResidentRequestDraft(
        applicant, society, draft.id, 1,
        { ...input, applicantNote: "Updated details." },
      );
      assert.equal(updated.revision, 2);
      assert.equal(updated.applicantNote, "Updated details.");

      await assert.rejects(
        updateResidentRequestDraft(
          applicant, society, draft.id, 1,
          { ...input, applicantNote: "Stale overwrite." },
        ),
        hasCode("REVISION_CONFLICT"),
      );

      const stored = await pool.query(
        `SELECT revision, applicant_note
         FROM resident_unit_requests WHERE id = $1`,
        [draft.id],
      );
      assert.deepEqual(stored.rows[0], {
        revision: 2,
        applicant_note: "Updated details.",
      });

      const events = await pool.query(
        `SELECT action FROM resident_unit_request_events
         WHERE request_id = $1 ORDER BY request_revision`,
        [draft.id],
      );
      assert.deepEqual(events.rows.map((row) => row.action), [
        "created", "updated",
      ]);
    });

    await t.test("disabled and administrator accounts cannot create requests", async () => {
      await pool.query(
        "UPDATE users SET status = 'disabled' WHERE id = $1",
        [otherUser],
      );
      try {
        await assert.rejects(
          createResidentRequestDraft(otherUser, society, input),
          hasCode("FORBIDDEN"),
        );
      } finally {
        await pool.query(
          "UPDATE users SET status = 'active' WHERE id = $1",
          [otherUser],
        );
      }

      await assert.rejects(
        createResidentRequestDraft(admin, society, input),
        hasCode("FORBIDDEN"),
      );
    });

    await t.test("suspended societies cannot receive requests", async () => {
      await pool.query(
        "UPDATE societies SET service_status = 'suspended' WHERE id = $1",
        [society],
      );
      try {
        await assert.rejects(
          createResidentRequestDraft(otherUser, society, input),
          hasCode("NOT_FOUND"),
        );
      } finally {
        await pool.query(
          "UPDATE societies SET service_status = 'inactive' WHERE id = $1",
          [society],
        );
      }
    });

    await t.test("unapproved societies cannot receive requests", async () => {
      await pool.query(
        `UPDATE society_applications
         SET status = 'pending_review',
             reviewed_at = NULL, reviewed_by = NULL, review_note = NULL
         WHERE society_id = $1`,
        [otherSociety],
      );

      await assert.rejects(
        createResidentRequestDraft(otherUser, otherSociety, {
          unitId: foreignUnit,
          relationship: "owner",
        }),
        hasCode("NOT_FOUND"),
      );
    });

    await t.test("private document access uses database relationships", async (documents) => {
      const chairman = randomUUID();
      const roommate = randomUUID();
      const stranger = randomUUID();

      // Include all new test users in the existing cleanup.
      users.push(chairman, roommate, stranger);

      for (const userId of [chairman, roommate, stranger]) {
        await pool.query(
          `INSERT INTO users (
             id, full_name, email, phone, date_of_birth,
             status, email_verified_at, phone_verified_at
           ) VALUES (
             $1, 'Document Access Test', $2, $3, '1990-01-01',
             'active', clock_timestamp(), clock_timestamp()
           )`,
          [
            userId,
            `document-test-${userId}@example.invalid`,
            `+919${randomInt(100_000_000, 1_000_000_000)}`,
          ],
        );
      }

      await pool.query(
        `INSERT INTO society_memberships (society_id, user_id, role, status)
         VALUES ($1, $2, 'chairman', 'active')`,
        [society, chairman],
      );

      const ownerRequest = randomUUID();
      await pool.query(
        `INSERT INTO resident_unit_requests (
           id, society_id, unit_id, user_id, relationship,
           status, submitted_at, reviewed_at, reviewed_by
         ) VALUES (
           $1, $2, $3, $4, 'owner', 'approved',
           clock_timestamp(), clock_timestamp(), $5
         )`,
        [ownerRequest, society, secondUnit, otherUser, chairman],
      );

      await pool.query(
        `INSERT INTO resident_unit_memberships (
           society_id, unit_id, user_id, relationship,
           source_request_id, approved_by
         ) VALUES ($1, $2, $3, 'owner', $4, $5)`,
        [society, secondUnit, otherUser, ownerRequest, chairman],
      );

      const tenancy = randomUUID();
      await pool.query(
        `INSERT INTO resident_tenancies (
           id, society_id, unit_id, created_by, starts_on, ends_on
         ) VALUES ($1, $2, $3, $4, '2020-01-01', '2099-12-31')`,
        [tenancy, society, secondUnit, applicant],
      );

      const tenantResult = await pool.query<{ id: string }>(
        `UPDATE resident_unit_requests
         SET tenancy_id = $3, status = 'pending',
             submitted_at = clock_timestamp()
         WHERE user_id = $1 AND unit_id = $2
           AND relationship = 'tenant'
         RETURNING id`,
        [applicant, secondUnit, tenancy],
      );
      assert.equal(tenantResult.rowCount, 1);
      const tenantRequest = tenantResult.rows[0].id;

      const roommateRequest = randomUUID();
      await pool.query(
        `INSERT INTO resident_unit_requests (
           id, society_id, unit_id, user_id, relationship,
           tenancy_id, status, owner_review_status, submitted_at
         ) VALUES (
           $1, $2, $3, $4, 'tenant', $5, 'pending', 'pending',
           clock_timestamp()
         )`,
        [roommateRequest, society, secondUnit, roommate, tenancy],
      );

      const agreement = randomUUID();
      const replacementAgreement = randomUUID();
      const identity = randomUUID();

      for (const [documentId, version] of [
        [agreement, 1],
        [replacementAgreement, 2],
      ] as const) {
        await pool.query(
          `INSERT INTO resident_documents (
             id, society_id, uploaded_by, kind,
             tenancy_id, agreement_version,
             original_filename, storage_bucket, storage_key,
             declared_content_type, declared_size_bytes,
             verified_content_type, verified_size_bytes,
             sha256, status, verified_at
           ) VALUES (
             $1, $2, $3, 'rental_agreement', $4, $5,
             'agreement.pdf', 'test-private', $6,
             'application/pdf', 100,
             'application/pdf', 100,
             $7, 'ready', clock_timestamp()
           )`,
          [
            documentId, society, applicant, tenancy, version,
            `test/${documentId}`, "a".repeat(64),
          ],
        );
      }

      await pool.query(
        `INSERT INTO resident_documents (
           id, society_id, uploaded_by, kind,
           request_id, subject_user_id,
           original_filename, storage_bucket, storage_key,
           declared_content_type, declared_size_bytes,
           verified_content_type, verified_size_bytes,
           sha256, status, verified_at
         ) VALUES (
           $1, $2, $3, 'identity', $4, $3,
           'identity.pdf', 'test-private', $5,
           'application/pdf', 100,
           'application/pdf', 100,
           $6, 'ready', clock_timestamp()
         )`,
        [
          identity, society, applicant, tenantRequest,
          `test/${identity}`, "b".repeat(64),
        ],
      );

      async function denied(userId: string, documentId: string) {
        await assert.rejects(
          authoriseResidentDocumentRead(userId, documentId),
          ResidentDocumentAccessError,
        );
      }

      await documents.test("owner reviews the tenant ID; chairman must wait", async () => {
        assert.equal(
          (await authoriseResidentDocumentRead(otherUser, identity)).accessBasis,
          "verified_owner",
        );
        await denied(chairman, identity);
        await denied(roommate, identity);
      });

      await pool.query(
        `UPDATE resident_unit_requests
         SET owner_review_status = 'approved',
             owner_reviewed_by = $2,
             owner_reviewed_at = clock_timestamp(),
             owner_reviewed_agreement_id = $3
         WHERE id IN ($1, $4)`,
        [tenantRequest, otherUser, agreement, roommateRequest],
      );

      await documents.test("chairman can review the ID but not either agreement", async () => {
        assert.equal(
          (await authoriseResidentDocumentRead(chairman, identity)).accessBasis,
          "chairman_identity_review",
        );
        await denied(chairman, agreement);
        await denied(chairman, replacementAgreement);
      });

      await documents.test("verified owner and uploader can read the agreement", async () => {
        assert.equal(
          (await authoriseResidentDocumentRead(otherUser, agreement)).accessBasis,
          "verified_owner",
        );
        assert.equal(
          (await authoriseResidentDocumentRead(applicant, agreement)).accessBasis,
          "self",
        );
      });

      await documents.test("roommate access is restricted to the confirmed version", async () => {
        assert.equal(
          (await authoriseResidentDocumentRead(roommate, agreement)).accessBasis,
          "agreement_participant",
        );
        await denied(roommate, replacementAgreement);
        await denied(roommate, identity);
      });

      await documents.test("unrelated users, admins and missing documents are denied", async () => {
        await denied(stranger, agreement);
        await denied(stranger, identity);
        await denied(admin, agreement);
        await denied(admin, identity);
        await denied(applicant, randomUUID());

        const audit = await pool.query(
          `SELECT id FROM resident_document_events
           WHERE actor_user_id = ANY($1::uuid[])`,
          [[stranger, admin]],
        );
        assert.equal(audit.rowCount, 0);
      });

      await documents.test("an approved then revoked roommate loses agreement access", async () => {
        await pool.query(
          `UPDATE resident_unit_requests
           SET status = 'approved', reviewed_by = $2,
               reviewed_at = clock_timestamp()
           WHERE id = $1`,
          [roommateRequest, chairman],
        );

        await pool.query(
          `INSERT INTO resident_unit_memberships (
             society_id, unit_id, user_id, relationship,
             source_request_id, approved_by
           ) VALUES ($1, $2, $3, 'tenant', $4, $5)`,
          [society, secondUnit, roommate, roommateRequest, chairman],
        );

        assert.equal(
          (await authoriseResidentDocumentRead(roommate, agreement)).accessBasis,
          "agreement_participant",
        );

        await pool.query(
          `UPDATE resident_unit_memberships
           SET status = 'revoked', revoked_at = clock_timestamp(),
               revoked_by = $2, revocation_reason = 'Test move-out'
           WHERE source_request_id = $1`,
          [roommateRequest, chairman],
        );
        await denied(roommate, agreement);
      });

      await documents.test("unverified documents cannot be opened", async () => {
        await pool.query(
          "UPDATE resident_documents SET status = 'pending' WHERE id = $1",
          [identity],
        );
        try {
          await denied(applicant, identity);
          await denied(otherUser, identity);
          await denied(chairman, identity);
        } finally {
          await pool.query(
            "UPDATE resident_documents SET status = 'ready' WHERE id = $1",
            [identity],
          );
        }
      });

      await documents.test("ended tenancies deny agreement access even to the owner", async () => {
        await pool.query(
          `UPDATE resident_tenancies
           SET status = 'ended', ended_at = clock_timestamp(),
               ended_by = $2, end_reason = 'Test tenancy ended'
           WHERE id = $1`,
          [tenancy, otherUser],
        );
        await denied(otherUser, agreement);
        await denied(applicant, agreement);
      });
    });

    await t.test("submitted requests cannot be edited as drafts", async () => {
      // Fixture transition only; this does not expose a submission API.
      await pool.query(
        `UPDATE resident_unit_requests
         SET status = 'pending', submitted_at = clock_timestamp()
         WHERE id = $1`,
        [draft.id],
      );
      await assert.rejects(
        updateResidentRequestDraft(
          applicant, society, draft.id, 2, input,
        ),
        hasCode("NOT_EDITABLE"),
      );
    });
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");

      // Release agreement references before removing test documents.
      await cleanup.query(
        `UPDATE resident_unit_requests
         SET status = 'draft',
             submitted_at = NULL,
             reviewed_at = NULL,
             reviewed_by = NULL,
             review_note = NULL,
             owner_review_status = CASE
               WHEN relationship = 'tenant' THEN 'pending'
               ELSE 'not_required'
             END,
             owner_reviewed_at = NULL,
             owner_reviewed_by = NULL,
             owner_review_note = NULL,
             owner_reviewed_agreement_id = NULL
         WHERE society_id = ANY($1::uuid[])`,
        [societies],
      );

      for (const table of [
        "resident_document_events",
        "resident_documents",
        "resident_unit_request_events",
        "resident_unit_memberships",
        "resident_unit_requests",
        "resident_tenancy_events",
        "resident_tenancies",
        "society_memberships",
        "society_units",
        "society_applications",
      ]) {
        await cleanup.query(
          `DELETE FROM ${table} WHERE society_id = ANY($1::uuid[])`,
          [societies],
        );
      }

      await cleanup.query(
        "DELETE FROM societies WHERE id = ANY($1::uuid[])",
        [societies],
      );
      await cleanup.query(
        "DELETE FROM platform_admins WHERE user_id = $1",
        [admin],
      );
      await cleanup.query(
        "DELETE FROM users WHERE id = ANY($1::uuid[])",
        [users],
      );
      await cleanup.query("COMMIT");
    } catch (error) {
      await cleanup.query("ROLLBACK");
      throw error;
    } finally {
      cleanup.release();
      await pool.end();
    }
  }
});
