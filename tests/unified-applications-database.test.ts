import { listApplicationInbox } from "../src/lib/server/services/owner-application-review.service";
import { loadResidentDashboard } from "../src/lib/server/services/resident-dashboard.service";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getDatabase } from "../src/lib/server/db";
import { createResidentRequestDraft, updateResidentRequestDraft } from "../src/lib/server/services/resident-requests.service";
import { submitResidentApplication, reviewTenantApplication, listTenantReviews } from "../src/lib/server/services/tenant-applications.service";
import { authoriseResidentDocumentRead } from "../src/lib/server/services/resident-document-access.service";
import { ownerOccupancy } from "../src/lib/server/services/owner-occupancy.service";

test("unified applications and upcoming tenant homes", async (t) => {
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
    await t.test("owners cannot discover tenant drafts",async()=>{
      assert.equal((await listApplicationInbox(owner,null,{})).items.some(item=>item.id===draft.id),false);
      assert.equal((await listApplicationInbox(tenant,null,{scope:"mine"})).items.some(item=>item.id===draft.id),true);
    });
    await t.test("owner cards exclude drafts and preserve reported occupancy", async () => {
      const home = (await loadResidentDashboard(owner, pool)).homes.find(row => row.unitId === unit);
      assert.ok(home);
      assert.equal(home.occupancyBadge, "VARR");
      assert.deepEqual(home.approvedTenants, []);
      assert.deepEqual(home.pendingTenantReviews, []);
    });
    const pending = await submitResidentApplication(tenant, society, draft.id, draft.revision);
    await t.test("pending tenant review is separate from occupancy", async () => {
      const home = (await loadResidentDashboard(owner, pool)).homes.find(row => row.unitId === unit);
      assert.ok(home);
      assert.equal(home.occupancyBadge, "VARR");
      assert.deepEqual(home.approvedTenants, []);
      assert.deepEqual(home.pendingTenantReviews, [{requestId: draft.id}]);
      assert.equal((await loadResidentDashboard(stranger, pool)).homes.length, 0);
    });
    await t.test("one list combines owned applications and incoming tenant requests",async()=>{
      const all=await listApplicationInbox(owner,null,{});
      assert.ok(all.items.some(item=>item.id===ownerRequest && item.isOwn));
      const incoming=all.items.find(item=>item.id===draft.id);
      assert.ok(incoming);assert.equal(incoming.isOwn,false);
      assert.ok(incoming.email);assert.equal(incoming.moveInDate,dates.start);
      assert.equal(incoming.tenancyEndDate,dates.end);
      assert.ok(incoming.reviewDocuments?.some(doc=>doc.id===agreement));
      assert.equal((await listApplicationInbox(owner,null,{scope:"mine"})).items.some(item=>item.id===draft.id),false);
      assert.equal((await listApplicationInbox(owner,null,{scope:"review"})).items[0]?.id,draft.id);
      assert.equal((await listApplicationInbox(owner,null,{stage:"chairman"})).items.some(item=>item.id===draft.id),false);
      assert.equal((await listApplicationInbox(stranger,null,{})).items.length,0);
      assert.equal((await listApplicationInbox(chairman,society,{})).items.some(item=>item.id===draft.id),false);
    });

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
    await t.test("correction history remains visible without new review actions or document links",async()=>{
      const history=(await listApplicationInbox(owner,null,{})).items.find(item=>item.id===draft.id);
      assert.equal(history?.status,"changes_requested");
      assert.deepEqual(history?.reviewDocuments,[]);
      assert.equal((await listApplicationInbox(owner,null,{scope:"review"})).items.length,0);
    });
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
    await t.test("chairman sees detailed tenant application after owner approval, without agreement metadata",async()=>{
      const item=(await listApplicationInbox(chairman,society,{})).items.find(row=>row.id===draft.id);
      assert.ok(item);assert.ok(item.ownerReviewedAt);assert.ok(item.applicantProfile);
      assert.deepEqual(item.reviewDocuments,[]);
      assert.equal((await listApplicationInbox(owner,null,{scope:"review"})).items.length,0);
      assert.ok((await listApplicationInbox(owner,null,{stage:"chairman"})).items.some(row=>row.id===draft.id));
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
    await t.test("owner cards show current approved tenant; tenant receives no owner review data", async () => {
      const home = (await loadResidentDashboard(owner, pool)).homes.find(row => row.unitId === unit);
      assert.ok(home);
      assert.equal(home.occupancyBadge, "CR");
      assert.equal(home.approvedTenants?.length, 1);
      assert.equal(home.approvedTenants?.[0].requestId, draft.id);
      assert.equal(home.approvedTenants?.[0].name, "Tenant Flow Test");
      assert.equal(home.approvedTenants?.[0].state, "active");
      assert.equal(home.approvedTenants?.[0].startDate, dates.start);
      assert.equal(home.approvedTenants?.[0].endDate, dates.end);
      assert.deepEqual(home.pendingTenantReviews, []);
      const tenantHome = (await loadResidentDashboard(tenant, pool)).homes.find(row => row.unitId === unit);
      assert.deepEqual(tenantHome?.approvedTenants, []);
      assert.deepEqual(tenantHome?.pendingTenantReviews, []);
    });
    await t.test("approved tenant remains listed for applicant and reviewing owner",async()=>{
      assert.ok((await listApplicationInbox(tenant,null,{scope:"mine",status:"approved"})).items.some(item=>item.id===draft.id));
      assert.ok((await listApplicationInbox(owner,null,{status:"approved"})).items.some(item=>item.id===draft.id));
      assert.equal((await listApplicationInbox(owner,null,{scope:"review"})).items.length,0);
    });
    await t.test("upcoming homes are visible while revoked or expired homes are excluded",async()=>{
      await pool.query(`UPDATE resident_unit_memberships SET move_in_date=(now() AT TIME ZONE 'Asia/Kolkata')::date+7,
        tenancy_end_date=(now() AT TIME ZONE 'Asia/Kolkata')::date+30 WHERE source_request_id=$1`,[draft.id]);
      const future=(await loadResidentDashboard(tenant,pool)).homes.find(home=>home.unitId===unit);
      assert.ok(future);assert.equal(future.accessState,"upcoming");assert.ok(future.moveInDate);
      assert.equal((await loadResidentDashboard(stranger,pool)).homes.length,0);
      const current=(await loadResidentDashboard(owner,pool)).homes.find(home=>home.unitId===unit);
      assert.equal(current?.accessState,"active");
      assert.equal(current?.occupancyBadge,"UT");
      assert.equal(current?.approvedTenants?.[0].state,"upcoming");
      assert.equal(current?.approvedTenants?.[0].startDate,future.moveInDate);
      await pool.query(`UPDATE resident_unit_memberships SET move_in_date=(now() AT TIME ZONE 'Asia/Kolkata')::date,
        tenancy_end_date=(now() AT TIME ZONE 'Asia/Kolkata')::date WHERE source_request_id=$1`,[draft.id]);
      assert.equal((await loadResidentDashboard(tenant,pool)).homes[0]?.accessState,"active");
      await pool.query(`UPDATE resident_unit_memberships SET move_in_date=(now() AT TIME ZONE 'Asia/Kolkata')::date-2,
        tenancy_end_date=(now() AT TIME ZONE 'Asia/Kolkata')::date-1 WHERE source_request_id=$1`,[draft.id]);
      assert.equal((await loadResidentDashboard(tenant,pool)).homes.length,0);
      await pool.query(`UPDATE resident_unit_memberships SET tenancy_end_date=NULL,status='revoked',revoked_at=now(),
        revoked_by=$2,revocation_reason='Test revoked' WHERE source_request_id=$1`,[draft.id,chairman]);
      assert.equal((await loadResidentDashboard(tenant,pool)).homes.length,0);
    });
    await t.test("revoked tenants disappear from owner cards; reported CR has no invented tenant", async () => {
      const home = (await loadResidentDashboard(owner, pool)).homes.find(row => row.unitId === unit);
      assert.deepEqual(home?.approvedTenants, []);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE society_units SET owner_occupancy_report='CR',
             occupancy_report_membership_id=(
               SELECT id FROM resident_unit_memberships WHERE source_request_id=$2 LIMIT 1
             ), occupancy_reported_at=now()
           WHERE id=$1`, [unit, ownerRequest],
        );
        const reported = (await loadResidentDashboard(owner, client)).homes.find(row => row.unitId === unit);
        assert.equal(reported?.occupancyBadge, "CR");
        assert.deepEqual(reported?.approvedTenants, []);
      } finally {
        try { await client.query("ROLLBACK"); }
        finally { client.release(); }
      }
    });
    await t.test("a former owner loses incoming application history",async()=>{
      await pool.query(`UPDATE resident_unit_memberships SET status='revoked',revoked_at=now(),revoked_by=$2,
        revocation_reason='Test ownership ended' WHERE source_request_id=$1`,[ownerRequest,chairman]);
      assert.equal((await listApplicationInbox(owner,null,{})).items.some(item=>item.id===draft.id),false);
      assert.equal((await loadResidentDashboard(owner,pool)).homes.some(home=>home.unitId===unit),false);
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
