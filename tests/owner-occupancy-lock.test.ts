import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getDatabase } from "../src/lib/server/db";
import { ownerOccupancy } from "../src/lib/server/services/owner-occupancy.service";

test("owner occupancy respects current tenancy locks", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""));
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  const pool = getDatabase();
  const society = randomUUID();
  const unit = randomUUID();
  const owner = randomUUID();
  const tenant = randomUUID();
  const reviewer = randomUUID();
  const stranger = randomUUID();
  const ownerRequest = randomUUID();
  const tenantRequest = randomUUID();
  const tenancy = randomUUID();
  const agreement = randomUUID();
  const tenantMembership = randomUUID();
  const users = [owner, tenant, reviewer, stranger];

  const setup = await pool.connect();
  try {
    await setup.query("BEGIN");
    for (const id of users) {
      await setup.query(
        `INSERT INTO users
          (id,full_name,email,phone,date_of_birth,status,email_verified_at,phone_verified_at)
         VALUES($1,'Occupancy Lock Test',$2,$3,'1990-01-01',
           'active',clock_timestamp(),clock_timestamp())`,
        [id, `${id}@example.invalid`, `+919${randomInt(100_000_000, 1_000_000_000)}`],
      );
    }
    await setup.query(
      "INSERT INTO platform_admins(user_id) VALUES($1)",
      [reviewer],
    );
    await setup.query(
      `INSERT INTO societies
        (id,name,address_line_1,city,state_or_union_territory,pin_code,
         wing_count,total_units,one_bhk_units,created_by)
       VALUES($1,'Occupancy Test Society','12 Test Street','Pune',
         'Maharashtra','411001',1,1,1,$2)`,
      [society, owner],
    );
    await setup.query(
      `INSERT INTO society_applications
        (society_id,applicant_user_id,status,submitted_at,reviewed_at,reviewed_by)
       VALUES($1,$2,'approved',now(),now(),$3)`,
      [society, owner, reviewer],
    );
    await setup.query(
      `INSERT INTO society_units(id,society_id,wing,flat_number,created_by)
       VALUES($1,$2,'B','304',$3)`,
      [unit, society, owner],
    );
    await setup.query(
      `INSERT INTO resident_unit_requests
        (id,society_id,unit_id,user_id,relationship,status,
         submitted_at,reviewed_at,reviewed_by,applicant_profile)
       VALUES($1,$2,$3,$4,'owner','approved',now(),now(),$5,
         '{"residesInFlat":false,"occupancyWhenAway":"VARR"}')`,
      [ownerRequest, society, unit, owner, reviewer],
    );
    await setup.query(
      `INSERT INTO resident_unit_memberships
        (society_id,unit_id,user_id,relationship,source_request_id,approved_by)
       VALUES($1,$2,$3,'owner',$4,$5)`,
      [society, unit, owner, ownerRequest, reviewer],
    );
    await setup.query(
      `INSERT INTO resident_tenancies
        (id,society_id,unit_id,created_by,starts_on,ends_on)
       VALUES($1,$2,$3,$4,
         (now() AT TIME ZONE 'Asia/Kolkata')::date-30,
         (now() AT TIME ZONE 'Asia/Kolkata')::date)`,
      [tenancy, society, unit, tenant],
    );
    // Test metadata only: no bucket upload or real document is created.
    await setup.query(
      `INSERT INTO resident_documents
        (id,society_id,uploaded_by,kind,tenancy_id,agreement_version,
         original_filename,storage_bucket,storage_key,
         declared_content_type,declared_size_bytes)
       VALUES($1,$2,$3,'rental_agreement',$4,1,'test.pdf',
         'test-only',$5::text,'application/pdf',1)`,
      [agreement, society, tenant, tenancy, `test-${agreement}`],
    );
    await setup.query(
      `INSERT INTO resident_unit_requests
        (id,society_id,unit_id,user_id,relationship,status,
         submitted_at,reviewed_at,reviewed_by,
         tenancy_id,move_in_date,tenancy_end_date,
         owner_review_status,owner_reviewed_at,owner_reviewed_by,
         owner_reviewed_agreement_id)
       VALUES($1,$2,$3,$4,'tenant','approved',now(),now(),$5,
         $6,(now() AT TIME ZONE 'Asia/Kolkata')::date-30,
         (now() AT TIME ZONE 'Asia/Kolkata')::date,
         'approved',now(),$7,$8)`,
      [tenantRequest, society, unit, tenant, reviewer, tenancy, owner, agreement],
    );
    await setup.query(
      `INSERT INTO resident_unit_memberships
        (id,society_id,unit_id,user_id,relationship,source_request_id,
         approved_by,move_in_date,tenancy_end_date)
       VALUES($1,$2,$3,$4,'tenant',$5,$6,
         (now() AT TIME ZONE 'Asia/Kolkata')::date-30,
         (now() AT TIME ZONE 'Asia/Kolkata')::date)`,
      [tenantMembership, society, unit, tenant, tenantRequest, reviewer],
    );
    await setup.query("COMMIT");
  } catch (error) {
    try {
      await setup.query("ROLLBACK");
    } finally {
      setup.release();
      await pool.end();
    }
    throw error;
  }
  setup.release();

  async function read() {
    const result = await ownerOccupancy(owner, society, unit);
    assert.ok("occupancyLocked" in result);
    return result;
  }

  async function save(occupancy: string, revision: number, actor = owner) {
    return ownerOccupancy(actor, society, unit, {
      societyId: society, unitId: unit, expectedRevision: revision, occupancy,
    });
  }

  async function setEnd(offset: number | null) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [table, id] of [
        ["resident_tenancies", tenancy],
        ["resident_unit_requests", tenantRequest],
        ["resident_unit_memberships", tenantMembership],
      ]) {
        const column = table === "resident_tenancies" ? "ends_on" : "tenancy_end_date";
        await client.query(
          `UPDATE ${table} SET ${column}=
             CASE WHEN $2::integer IS NULL THEN NULL
               ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date+$2::integer END
           WHERE id=$1`,
          [id, offset],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  try {
    await t.test("agreement ending today locks every status, including CR", async () => {
      const current = await read();
      assert.equal(current.occupancyLocked, true);
      assert.equal(current.badge, "CR");
      for (const choice of ["VARR", "VNRR", "UM", "CR", "FO"]) {
        await assert.rejects(save(choice, current.revision), { status: 409 });
      }
      const after = await read();
      assert.equal(after.revision, current.revision);
      const events = await pool.query(
        "SELECT id FROM unit_events WHERE unit_id=$1", [unit],
      );
      assert.equal(events.rowCount, 0);
    });

    await t.test("no end date keeps occupancy locked", async () => {
      await setEnd(null);
      const current = await read();
      assert.equal(current.occupancyLocked, true);
      assert.equal(current.lockedUntil, null);
      await assert.rejects(save("UM", current.revision), { status: 409 });
    });

    await t.test("yesterday's expiry unlocks editing and records one audit event", async () => {
      await setEnd(-1);
      const current = await read();
      assert.equal(current.occupancyLocked, false);
      const saved = await save("UM", current.revision);
      assert.equal(saved.badge, "UM");
      assert.equal(saved.revision, current.revision + 1);
      const after = await read();
      assert.equal(after.badge, "UM");
      const events = await pool.query(
        "SELECT action FROM unit_events WHERE unit_id=$1", [unit],
      );
      assert.deepEqual(events.rows.map((row) => row.action), ["occupancy_updated"]);
    });

    await t.test("unchanged reports do not increment revision or add events", async () => {
      const current = await read();
      const saved = await save("UM", current.revision);
      assert.equal(saved.revision, current.revision);
      const events = await pool.query(
        "SELECT id FROM unit_events WHERE unit_id=$1", [unit],
      );
      assert.equal(events.rowCount, 1);
    });

    await t.test("stale revisions cannot overwrite a report", async () => {
      const current = await read();
      await assert.rejects(save("VARR", current.revision - 1), { status: 409 });
    });

    await t.test("tenant and unrelated account cannot update owner occupancy", async () => {
      const current = await read();
      for (const actor of [tenant, stranger]) {
        await assert.rejects(save("VARR", current.revision, actor), { status: 403 });
        await assert.rejects(ownerOccupancy(actor, society, unit), { status: 403 });
      }
    });

    await t.test("agreement extension re-locks a previously editable flat", async () => {
      await setEnd(10);
      const current = await read();
      assert.equal(current.occupancyLocked, true);
      assert.equal(current.badge, "CR");
      await assert.rejects(save("VNRR", current.revision), { status: 409 });
    });
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query(
        `UPDATE resident_unit_requests SET
           owner_review_status='pending',owner_reviewed_at=NULL,
           owner_reviewed_by=NULL,owner_review_note=NULL,
           owner_reviewed_agreement_id=NULL,
           status='withdrawn',reviewed_at=NULL,reviewed_by=NULL,review_note=NULL
         WHERE id=$1`,
        [tenantRequest],
      );
      for (const table of [
        "unit_events", "resident_unit_memberships",
        "resident_document_events", "resident_documents",
        "resident_unit_request_events", "resident_unit_requests",
        "resident_tenancy_events", "resident_tenancies",
        "society_units", "society_applications",
      ]) {
        await cleanup.query(`DELETE FROM ${table} WHERE society_id=$1`, [society]);
      }
      await cleanup.query("DELETE FROM societies WHERE id=$1", [society]);
      await cleanup.query(
        "DELETE FROM platform_admins WHERE user_id=$1",
        [reviewer],
      );
      await cleanup.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
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
