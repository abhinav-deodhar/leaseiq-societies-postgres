import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { unitDeletionRequestSchema, type UnitDeletionTarget } from "../src/lib/contracts/unit-deletion";
import { createUnitSchema } from "../src/lib/contracts/units";
import { manageUnitDeletion } from "../src/lib/server/services/unit-deletion.service";
import { createUnitForChairman } from "../src/lib/server/services/units.service";
import { getDatabase } from "../src/lib/server/db";

test("deletion contract rejects ambiguous or excessive targets", () => {
  const id = randomUUID();
  for (const target of [
    { scope: "selected", ids: [] },
    { scope: "selected", ids: [id, id] },
    { scope: "all", ids: [id] },
    { scope: "selected", ids: Array.from({ length: 501 }, () => randomUUID()) },
  ]) assert.equal(unitDeletionRequestSchema.safeParse({ mode: "preview", target }).success, false);
  assert.equal(unitDeletionRequestSchema.safeParse({ mode: "confirm", previewId: id, confirmation: "" }).success, false);
});

test("unit deletion database flows", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""));
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");
  const pool = getDatabase();
  const users: string[] = [];
  const societies: string[] = [];
  async function user() {
    const id = randomUUID();
    await pool.query(`INSERT INTO users
      (id,full_name,email,phone,date_of_birth,status,email_verified_at,phone_verified_at)
      VALUES ($1,'Deletion Test',$2,$3,'1990-01-01','active',clock_timestamp(),clock_timestamp())`,
    [id, `${id}@example.invalid`, `+919${randomInt(100_000_000, 1_000_000_000)}`]);
    users.push(id);
    return id;
  }
  try {
    const chairman = await user();
    const outsider = await user();
    const admin = await user();
    await pool.query("INSERT INTO platform_admins(user_id) VALUES($1)", [admin]);
    async function society() {
      const id = randomUUID();
      await pool.query(`INSERT INTO societies
        (id,name,address_line_1,city,state_or_union_territory,pin_code,wing_count,total_units,one_bhk_units,created_by)
        VALUES ($1,'Deletion Test Society','Test Street 123','Pune','Maharashtra','411001',2,100,100,$2)`, [id, chairman]);
      societies.push(id);
      await pool.query(`INSERT INTO society_memberships(society_id,user_id,role,status)
        VALUES($1,$2,'chairman','active')`, [id, chairman]);
      await pool.query(`INSERT INTO society_applications
        (society_id,applicant_user_id,status,submitted_at,reviewed_at,reviewed_by)
        VALUES($1,$2,'approved',clock_timestamp(),clock_timestamp(),$3)`, [id, chairman, admin]);
      return id;
    }
    async function unit(societyId: string, flatNumber: string) {
      return createUnitForChairman(chairman, societyId, createUnitSchema.parse({ wing: "A", floorLabel: "1", flatNumber }));
    }
    async function preview(societyId: string, target: UnitDeletionTarget) {
      const result = await manageUnitDeletion(chairman, societyId, { mode: "preview", target });
      assert.ok("previewId" in result);
      return result;
    }
    async function exists(id: string) {
      const result = await pool.query("SELECT id FROM society_units WHERE id=$1", [id]);
      return result.rowCount === 1;
    }

    await t.test("single deletion preserves full audit history and is single-use", async () => {
      const s = await society(); const u = await unit(s, "001");
      const p = await preview(s, { scope: "selected", ids: [u.id] });
      assert.equal(await exists(u.id), true);
      assert.deepEqual(p.rows[0].reasons, []);
      const input = { mode: "confirm" as const, previewId: p.previewId, confirmation: "DELETE" };
      assert.deepEqual(await manageUnitDeletion(chairman, s, input), { deleted: 1, blocked: 0 });
      assert.equal(await exists(u.id), false);
      const archive = await pool.query("SELECT * FROM deleted_unit_history WHERE unit_id=$1", [u.id]);
      assert.equal(archive.rows[0].unit_snapshot.flat_number, "001");
      assert.equal(archive.rows[0].deleted_by, chairman);
      assert.equal(archive.rows[0].event_history.length, 1);
      assert.equal(archive.rows[0].event_history[0].action, "created");
      await assert.rejects(manageUnitDeletion(chairman, s, input), { status: 409 });
    });

    await t.test("selected deletion retains protected units and unselected units", async () => {
      const s = await society(); const a = await unit(s, "101");
      const b = await unit(s, "102"); const c = await unit(s, "103");
      await pool.query(`INSERT INTO unit_billing_contacts
        (society_id,unit_id,full_name,role,starts_on,created_by)
        VALUES($1,$2,'Test Contact','owner','2026-01-01',$3)`, [s, b.id, chairman]);
      const p = await preview(s, { scope: "selected", ids: [a.id, b.id] });
      assert.ok(p.rows.find((row) => row.id === b.id)?.reasons.includes("Billing contact history"));
      assert.deepEqual(await manageUnitDeletion(chairman, s, { mode: "confirm", previewId: p.previewId, confirmation: "DELETE" }), { deleted: 1, blocked: 1 });
      assert.equal(await exists(a.id), false);
      assert.equal(await exists(b.id), true);
      assert.equal(await exists(c.id), true);
    });

    await t.test("all covers more than one page and requires the society name", async () => {
      const s = await society();
      for (let i = 0; i < 51; i++) await unit(s, String(i + 1));
      const p = await preview(s, { scope: "all" });
      assert.equal(p.rows.length, 51);
      await assert.rejects(manageUnitDeletion(chairman, s, { mode: "confirm", previewId: p.previewId, confirmation: "DELETE" }), { status: 400 });
      assert.deepEqual(await manageUnitDeletion(chairman, s, { mode: "confirm", previewId: p.previewId, confirmation: p.societyName }), { deleted: 51, blocked: 0 });
    });

    await t.test("new units invalidate an all-unit preview", async () => {
      const s = await society(); const a = await unit(s, "1");
      const p = await preview(s, { scope: "all" }); const b = await unit(s, "2");
      await assert.rejects(manageUnitDeletion(chairman, s, { mode: "confirm", previewId: p.previewId, confirmation: p.societyName }), { status: 409 });
      assert.equal(await exists(a.id), true); assert.equal(await exists(b.id), true);
    });

    await t.test("unit edits and newly linked records invalidate previews", async () => {
      const s = await society(); const u = await unit(s, "1");
      const p = await preview(s, { scope: "selected", ids: [u.id] });
      await pool.query("UPDATE society_units SET floor_label='2', revision=revision+1 WHERE id=$1", [u.id]);
      await assert.rejects(manageUnitDeletion(chairman, s, { mode: "confirm", previewId: p.previewId, confirmation: "DELETE" }), { status: 409 });
      const next = await preview(s, { scope: "selected", ids: [u.id] });
      await pool.query(`INSERT INTO unit_billing_contacts
        (society_id,unit_id,full_name,role,starts_on,created_by)
        VALUES($1,$2,'Test Contact','owner','2026-01-01',$3)`, [s, u.id, chairman]);
      await assert.rejects(manageUnitDeletion(chairman, s, { mode: "confirm", previewId: next.previewId, confirmation: "DELETE" }), { status: 409 });
      assert.equal(await exists(u.id), true);
    });

    await t.test("foreign units, unauthorized users, and another actor's preview are rejected", async () => {
      const s = await society(); const other = await society(); const u = await unit(s, "1");
      await assert.rejects(manageUnitDeletion(outsider, s, { mode: "preview", target: { scope: "all" } }), { code: "FORBIDDEN" });
      await assert.rejects(preview(other, { scope: "selected", ids: [u.id] }), { status: 409 });
      const p = await preview(s, { scope: "selected", ids: [u.id] });
      // Simulate a preview owned by a different actor without relying on
      // whether a society permits multiple active chairmen.
      await pool.query("UPDATE unit_deletion_previews SET actor_user_id=$1 WHERE id=$2", [outsider, p.previewId]);
      await assert.rejects(manageUnitDeletion(chairman, s, { mode: "confirm", previewId: p.previewId, confirmation: "DELETE" }), { status: 409 });
      assert.equal(await exists(u.id), true);
    });

    await t.test("expired previews cannot delete units", async () => {
      const s = await society(); const u = await unit(s, "1");
      const p = await preview(s, { scope: "selected", ids: [u.id] });
      await pool.query("UPDATE unit_deletion_previews SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [p.previewId]);
      await assert.rejects(manageUnitDeletion(chairman, s, { mode: "confirm", previewId: p.previewId, confirmation: "DELETE" }), { status: 409 });
      assert.equal(await exists(u.id), true);
    });

    await t.test("concurrent confirmations delete exactly once", async () => {
      const s = await society(); const u = await unit(s, "1");
      const p = await preview(s, { scope: "selected", ids: [u.id] });
      const input = { mode: "confirm" as const, previewId: p.previewId, confirmation: "DELETE" };
      const results = await Promise.allSettled([
        manageUnitDeletion(chairman, s, input), manageUnitDeletion(chairman, s, input),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    });

    await t.test("archive failure rolls back deletion and leaves the preview unused", async () => {
      const s = await society(); const u = await unit(s, "1");
      const p = await preview(s, { scope: "selected", ids: [u.id] });
      await pool.query(`INSERT INTO deleted_unit_history(unit_id,society_id,deleted_by,unit_snapshot,event_history)
        VALUES($1,$2,$3,'{}','[]')`, [u.id, s, chairman]);
      await assert.rejects(manageUnitDeletion(chairman, s, { mode: "confirm", previewId: p.previewId, confirmation: "DELETE" }));
      assert.equal(await exists(u.id), true);
      const events = await pool.query("SELECT id FROM unit_events WHERE unit_id=$1", [u.id]);
      assert.equal(events.rowCount, 1);
      const saved = await pool.query("SELECT consumed_at FROM unit_deletion_previews WHERE id=$1", [p.previewId]);
      assert.equal(saved.rows[0].consumed_at, null);
    });
  } finally {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const table of ["unit_deletion_previews", "deleted_unit_history", "unit_billing_contacts", "unit_events", "society_units", "society_unit_types"]) {
        await client.query(`DELETE FROM ${table} WHERE society_id=ANY($1::uuid[])`, [societies]);
      }
      await client.query(`DELETE FROM application_events WHERE application_id IN
        (SELECT id FROM society_applications WHERE society_id=ANY($1::uuid[]))`, [societies]);
      await client.query("DELETE FROM society_applications WHERE society_id=ANY($1::uuid[])", [societies]);
      await client.query("DELETE FROM society_memberships WHERE society_id=ANY($1::uuid[])", [societies]);
      await client.query("DELETE FROM societies WHERE id=ANY($1::uuid[])", [societies]);
      await client.query("DELETE FROM platform_admins WHERE user_id=ANY($1::uuid[])", [users]);
      await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); await pool.end(); }
  }
});
