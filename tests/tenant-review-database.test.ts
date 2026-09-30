import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getDatabase } from "../src/lib/server/db";
import { createResidentRequestDraft, updateResidentRequestDraft } from "../src/lib/server/services/resident-requests.service";
import { submitResidentApplication, reviewTenantApplication, listTenantReviews } from "../src/lib/server/services/tenant-applications.service";
import { authoriseResidentDocumentRead } from "../src/lib/server/services/resident-document-access.service";
import { ownerOccupancy } from "../src/lib/server/services/owner-occupancy.service";

test("tenant submission, owner verification and chairman approval", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""));
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");
  const pool = getDatabase();
  const society = randomUUID(), unit = randomUUID(), owner = randomUUID(), tenant = randomUUID();
  const chairman = randomUUID(), admin = randomUUID(), stranger = randomUUID();
  const users = [owner, tenant, chairman, admin, stranger];
  const ownerRequest = randomUUID(), tenancy = randomUUID();
  const setup = await pool.connect();
  let setupError: unknown;
  try {
    await setup.query("BEGIN");
    for (const id of users) await setup.query(
      `INSERT INTO users(id,full_name,email,phone,date_of_birth,status,email_verified_at,phone_verified_at)
       VALUES($1,'Tenant Flow Test',$2,$3,'1990-01-01','active',now(),now())`,
      [id, `${id}@example.invalid`, `+919${randomInt(100_000_000, 1_000_000_000)}`],
    );
    await setup.query("INSERT INTO platform_admins(user_id) VALUES($1)", [admin]);
    await setup.query(
      `INSERT INTO societies(id,name,address_line_1,city,state_or_union_territory,pin_code,wing_count,total_units,one_bhk_units,created_by)
       VALUES($1,'Tenant Flow Test Society','12 Test Street','Pune','Maharashtra','411001',1,1,1,$2)`, [society, chairman],
    );
    await setup.query(
      `INSERT INTO society_applications(society_id,applicant_user_id,status,submitted_at,reviewed_at,reviewed_by)
       VALUES($1,$2,'approved',now(),now(),$3)`, [society, chairman, admin],
    );
    await setup.query("INSERT INTO society_memberships(society_id,user_id,role,status) VALUES($1,$2,'chairman','active')", [society, chairman]);
    await setup.query("INSERT INTO society_units(id,society_id,wing,flat_number,created_by) VALUES($1,$2,'B','304',$3)", [unit, society, chairman]);
    await setup.query(
      `INSERT INTO resident_unit_requests(id,society_id,unit_id,user_id,relationship,status,submitted_at,reviewed_at,reviewed_by,applicant_profile)
       VALUES($1,$2,$3,$4,'owner','approved',now(),now(),$5,'{"residesInFlat":false,"occupancyWhenAway":"VARR"}')`,
      [ownerRequest, society, unit, owner, chairman],
    );
    await setup.query(
      `INSERT INTO resident_unit_memberships(society_id,unit_id,user_id,relationship,source_request_id,approved_by)
       VALUES($1,$2,$3,'owner',$4,$5)`, [society, unit, owner, ownerRequest, chairman],
    );
    await setup.query("COMMIT");
  } catch (error) {
    setupError = error;
    await setup.query("ROLLBACK");
  } finally { setup.release(); }
  if (setupError) { await pool.end(); throw setupError; }

  try {
    const dates = (await pool.query<{ start: string; end: string }>(
      `SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date-1)::text AS start,
       ((now() AT TIME ZONE 'Asia/Kolkata')::date+30)::text AS end`,
    )).rows[0];
    const profile = {
      firstName: "Tenant", lastName: "Test", residesInFlat: true, correspondenceSameAsFlat: true,
      correspondenceAddress: { line1: "", line2: "", city: "", state: "", pinCode: "" }, familyMembers: [],
    };
    const details = { unitId: unit, relationship: "tenant", moveInDate: dates.start, tenancyEndDate: dates.end };
    const draft = await createResidentRequestDraft(tenant, society, details, profile);
    async function document(kind: "identity" | "rental_agreement", version = 1) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO resident_documents(id,society_id,uploaded_by,kind,request_id,subject_user_id,tenancy_id,agreement_version,
         original_filename,storage_bucket,storage_key,declared_content_type,declared_size_bytes,
         verified_content_type,verified_size_bytes,sha256,status,created_at,verified_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'fixture.pdf','test-only',$9,'application/pdf',1,
         'application/pdf',1,$10,'ready',now(),now())`,
        [id, society, tenant, kind, kind === "identity" ? draft.id : null,
          kind === "identity" ? tenant : null, kind === "rental_agreement" ? tenancy : null,
          kind === "rental_agreement" ? version : null, `fixture-${id}`, "a".repeat(64)],
      );
      return id;
    }
    await t.test("missing agreement blocks submission without changing draft", async () => {
      await assert.rejects(submitResidentApplication(tenant, society, draft.id, draft.revision), { status: 400 });
      const row = (await pool.query("SELECT status FROM resident_unit_requests WHERE id=$1", [draft.id])).rows[0];
      assert.equal(row.status, "draft");
    });
    await pool.query(
      `INSERT INTO resident_tenancies(id,society_id,unit_id,created_by,starts_on,ends_on) VALUES($1,$2,$3,$4,$5,$6)`,
      [tenancy, society, unit, tenant, dates.start, dates.end],
    );
    await pool.query("UPDATE resident_unit_requests SET tenancy_id=$2 WHERE id=$1", [draft.id, tenancy]);
    const agreement = await document("rental_agreement");
    await t.test("missing identity also blocks submission", async () => {
      await assert.rejects(submitResidentApplication(tenant, society, draft.id, draft.revision), { status: 400 });
    });
    const identity = await document("identity");
    const pending = await submitResidentApplication(tenant, society, draft.id, draft.revision);
    await t.test("submission is retry-safe and reaches only the owner's queue", async () => {
      const repeat = await submitResidentApplication(tenant, society, draft.id, draft.revision);
      assert.equal(repeat.revision, pending.revision);
      assert.equal((await listTenantReviews(owner, null, 1)).items[0]?.id, draft.id);
      assert.equal((await listTenantReviews(stranger, null, 1)).items.length, 0);
      assert.equal((await listTenantReviews(chairman, society, 1)).items.length, 0);
      assert.equal((await pool.query("SELECT id FROM resident_unit_memberships WHERE source_request_id=$1", [draft.id])).rowCount, 0);
    });
    const approve = (revision: number) => ({ expectedRevision: revision, decision: "approved" });
    await t.test("chairman cannot skip owner review and strangers cannot verify", async () => {
      await assert.rejects(reviewTenantApplication(chairman, society, draft.id, approve(pending.revision), "chairman"), { status: 409 });
      await assert.rejects(reviewTenantApplication(stranger, society, draft.id, approve(pending.revision), "owner"));
      await assert.rejects(reviewTenantApplication(tenant, society, draft.id, approve(pending.revision), "owner"), { status: 403 });
      assert.equal((await authoriseResidentDocumentRead(owner, identity)).accessBasis, "verified_owner");
      assert.equal((await authoriseResidentDocumentRead(owner, agreement)).accessBasis, "verified_owner");
      await assert.rejects(authoriseResidentDocumentRead(chairman, identity));
      await assert.rejects(authoriseResidentDocumentRead(chairman, agreement));
    });
    const returned = await reviewTenantApplication(owner, society, draft.id, {
      expectedRevision: pending.revision, decision: "changes_requested", reviewNote: "Please confirm your move-in details.",
    }, "owner");
    const edited = await updateResidentRequestDraft(tenant, society, draft.id, returned.revision, details, profile);
    const resubmitted = await submitResidentApplication(tenant, society, draft.id, edited.revision);
    const verified = await reviewTenantApplication(owner, society, draft.id, approve(resubmitted.revision), "owner");
    await t.test("corrections return through owner review; owner approval grants no membership", async () => {
      assert.equal(verified.status, "pending");
      assert.equal((await pool.query("SELECT id FROM resident_unit_memberships WHERE source_request_id=$1", [draft.id])).rowCount, 0);
      const queue = await listTenantReviews(chairman, society, 1);
      assert.equal(queue.items[0]?.id, draft.id);
      assert.ok(queue.items[0].documents.every((doc) => doc.kind === "identity"));
      assert.equal((await authoriseResidentDocumentRead(chairman, identity)).accessBasis, "chairman_identity_review");
      await assert.rejects(authoriseResidentDocumentRead(chairman, agreement));
    });
    // Simulate an out-of-band agreement replacement to verify final approval
    // does not silently carry an owner's approval to another version.
    const replacement = await document("rental_agreement", 2);
    await t.test("chairman cannot approve a different agreement version", async () => {
      await assert.rejects(reviewTenantApplication(chairman, society, draft.id, approve(verified.revision), "chairman"), { status: 409 });
    });
    const corrections = await reviewTenantApplication(chairman, society, draft.id, {
      expectedRevision: verified.revision, decision: "changes_requested", reviewNote: "Please obtain owner verification of the updated agreement.",
    }, "chairman");
    const editedAgain = await updateResidentRequestDraft(tenant, society, draft.id, corrections.revision, details, profile);
    const again = await submitResidentApplication(tenant, society, draft.id, editedAgain.revision);
    const reverified = await reviewTenantApplication(owner, society, draft.id, approve(again.revision), "owner");
    await t.test("final approval creates one membership and locks owner occupancy", async () => {
      const outcomes = await Promise.allSettled([
        reviewTenantApplication(chairman, society, draft.id, approve(reverified.revision), "chairman"),
        reviewTenantApplication(chairman, society, draft.id, approve(reverified.revision), "chairman"),
      ]);
      assert.equal(outcomes.filter((value) => value.status === "fulfilled").length, 1);
      assert.equal((await pool.query("SELECT id FROM resident_unit_memberships WHERE source_request_id=$1", [draft.id])).rowCount, 1);
      const request = (await pool.query("SELECT owner_reviewed_agreement_id FROM resident_unit_requests WHERE id=$1", [draft.id])).rows[0];
      assert.equal(request.owner_reviewed_agreement_id, replacement);
      const occupancy = await ownerOccupancy(owner, society, unit);
      assert.ok("occupancyLocked" in occupancy);
      assert.equal(occupancy.occupancyLocked, true);
      assert.equal(occupancy.badge, "CR");
      assert.equal((await authoriseResidentDocumentRead(tenant, replacement)).accessBasis, "agreement_participant");
    });
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query(
        `UPDATE resident_unit_requests SET status='withdrawn',reviewed_at=NULL,reviewed_by=NULL,review_note=NULL,
         owner_review_status=CASE WHEN relationship='tenant' THEN 'pending' ELSE 'not_required' END,
         owner_reviewed_at=NULL,owner_reviewed_by=NULL,owner_review_note=NULL,owner_reviewed_agreement_id=NULL
         WHERE society_id=$1`, [society],
      );
      for (const table of ["resident_document_events", "resident_documents", "resident_unit_memberships", "resident_unit_request_events", "resident_unit_requests", "resident_tenancy_events", "resident_tenancies", "unit_events", "society_units", "society_unit_types", "society_memberships"]) {
        await cleanup.query(`DELETE FROM ${table} WHERE society_id=$1`, [society]);
      }
      await cleanup.query("DELETE FROM application_events WHERE application_id IN (SELECT id FROM society_applications WHERE society_id=$1)", [society]);
      await cleanup.query("DELETE FROM society_applications WHERE society_id=$1", [society]);
      await cleanup.query("DELETE FROM societies WHERE id=$1", [society]);
      await cleanup.query("DELETE FROM platform_admins WHERE user_id=$1", [admin]);
      await cleanup.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
      await cleanup.query("COMMIT");
    } catch (error) { await cleanup.query("ROLLBACK"); throw error; }
    finally { cleanup.release(); await pool.end(); }
  }
});
