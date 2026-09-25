import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createUnitSchema } from "../src/lib/contracts/units";
import { getDatabase } from "../src/lib/server/db";
import {
  createUnitForChairman,
  listUnitsForChairman,
} from "../src/lib/server/services/units.service";

const requireFromHere = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromHere("@next/env") as typeof import(
  "@next/env"
);

test("unit management and society isolation", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  loadEnvConfig(process.cwd(), true);
  assert.notEqual(process.env.NODE_ENV, "production");

  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? ""),
  );
  assert.equal(process.env.PGDATABASE, "leaseiq_societies_dev");

  const pool = getDatabase();
  const userIds: string[] = [];
  const societyIds: string[] = [];

  async function createUser() {
    const id = randomUUID();

    await pool.query(
      `INSERT INTO users (
         id, full_name, email, phone, date_of_birth,
         status, email_verified_at, phone_verified_at
       )
       VALUES (
         $1, 'Unit Test User', $2, $3, '1990-01-01',
         'active', clock_timestamp(), clock_timestamp()
       )`,
      [
        id,
        `units-${id}@example.invalid`,
        `+919${randomInt(100_000_000, 1_000_000_000)}`,
      ],
    );

    userIds.push(id);
    return id;
  }

  async function createSociety(chairmanId: string, adminId: string) {
    const id = randomUUID();

    await pool.query(
      `INSERT INTO societies (
         id, name, address_line_1, city, state_or_union_territory,
         pin_code, wing_count, total_units, one_bhk_units, created_by
       )
       VALUES (
         $1, 'Unit Test Society', 'Test Street 123',
         'Pune', 'Maharashtra', '411001', 2, 10, 10, $2
       )`,
      [id, chairmanId],
    );
    societyIds.push(id);

    await pool.query(
      `INSERT INTO society_memberships (
         society_id, user_id, role, status
       )
       VALUES ($1, $2, 'chairman', 'active')`,
      [id, chairmanId],
    );

    await pool.query(
      `INSERT INTO society_applications (
         society_id, applicant_user_id, status,
         submitted_at, reviewed_at, reviewed_by
       )
       VALUES (
         $1, $2, 'approved',
         clock_timestamp(), clock_timestamp(), $3
       )`,
      [id, chairmanId, adminId],
    );

    return id;
  }

  try {
    const chairman = await createUser();
    const otherChairman = await createUser();
    const admin = await createUser();

    await pool.query(
      "INSERT INTO platform_admins (user_id) VALUES ($1)",
      [admin],
    );

    const society = await createSociety(chairman, admin);
    const otherSociety = await createSociety(otherChairman, admin);

    await t.test("inactive subscription allows approved-chairman setup", async () => {
      const result = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "" },
      );

      assert.equal(result.total, 0);
      assert.equal(result.unitTypes.length, 5);

      const status = await pool.query<{ status: string }>(
        "SELECT service_status AS status FROM societies WHERE id = $1",
        [society],
      );

      assert.equal(status.rows[0].status, "inactive");
    });

    await t.test("creation preserves leading zeros and records history", async () => {
      const unit = await createUnitForChairman(
        chairman,
        society,
        createUnitSchema.parse({
          wing: " A ",
          floorLabel: " G ",
          flatNumber: " 001 ",
        }),
      );

      assert.equal(unit.wing, "A");
      assert.equal(unit.floorLabel, "G");
      assert.equal(unit.flatNumber, "001");
      assert.equal(unit.unitTypeId, null);
      assert.equal(unit.occupancyStatus, "unknown");
      assert.equal(unit.revision, 1);

      const events = await pool.query<{
        action: string;
        actor: string;
        snapshot: { flatNumber: string };
      }>(
        `SELECT action, actor_user_id AS actor, snapshot
         FROM unit_events WHERE unit_id = $1`,
        [unit.id],
      );

      assert.equal(events.rowCount, 1);
      assert.equal(events.rows[0].action, "created");
      assert.equal(events.rows[0].actor, chairman);
      assert.equal(events.rows[0].snapshot.flatNumber, "001");

      const counts = await pool.query<{ total: number }>(
        "SELECT total_units AS total FROM societies WHERE id = $1",
        [society],
      );

      assert.equal(counts.rows[0].total, 10);
    });

    await t.test("duplicate wing and flat are rejected regardless of floor", async () => {
      await assert.rejects(
        createUnitForChairman(
          chairman,
          society,
          createUnitSchema.parse({
            wing: " a ",
            floorLabel: "2",
            flatNumber: "001",
          }),
        ),
        { code: "DUPLICATE_UNIT" },
      );

      const result = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "" },
      );

      assert.equal(result.total, 1);
    });

    await t.test("unit types cannot cross society boundaries", async () => {
      const own = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "" },
      );
      const other = await listUnitsForChairman(
        otherChairman,
        otherSociety,
        { page: 1, search: "" },
      );

      await assert.rejects(
        createUnitForChairman(
          chairman,
          society,
          createUnitSchema.parse({
            wing: "A",
            flatNumber: "002",
            unitTypeId: other.unitTypes[0].id,
          }),
        ),
        { code: "INVALID_UNIT_TYPE" },
      );

      const unit = await createUnitForChairman(
        chairman,
        society,
        createUnitSchema.parse({
          wing: "A",
          flatNumber: "002",
          unitTypeId: own.unitTypes.find((type) => type.category === "one_bhk")!.id,
        }),
      );

      assert.equal(unit.unitTypeName, "1 BHK");
    });

    await t.test("another chairman cannot read or create units", async () => {
      await assert.rejects(
        listUnitsForChairman(
          otherChairman,
          society,
          { page: 1, search: "" },
        ),
        { code: "FORBIDDEN" },
      );

      await assert.rejects(
        createUnitForChairman(
          otherChairman,
          society,
          createUnitSchema.parse({ flatNumber: "999" }),
        ),
        { code: "FORBIDDEN" },
      );

      await assert.rejects(
        listUnitsForChairman(
          admin,
          society,
          { page: 1, search: "" },
        ),
        { code: "FORBIDDEN" },
      );
    });

    await t.test("suspension and revoked membership block access", async () => {
      await pool.query(
        "UPDATE societies SET service_status = 'suspended' WHERE id = $1",
        [society],
      );

      try {
        await assert.rejects(
          createUnitForChairman(
            chairman,
            society,
            createUnitSchema.parse({ flatNumber: "003" }),
          ),
          { code: "FORBIDDEN" },
        );
      } finally {
        await pool.query(
          "UPDATE societies SET service_status = 'inactive' WHERE id = $1",
          [society],
        );
      }

      await pool.query(
        `UPDATE society_memberships SET status = 'revoked'
         WHERE society_id = $1 AND user_id = $2`,
        [society, chairman],
      );

      try {
        await assert.rejects(
          listUnitsForChairman(
            chairman,
            society,
            { page: 1, search: "" },
          ),
          { code: "FORBIDDEN" },
        );
      } finally {
        await pool.query(
          `UPDATE society_memberships SET status = 'active'
           WHERE society_id = $1 AND user_id = $2`,
          [society, chairman],
        );
      }
    });

    await t.test("search and lists remain society-specific", async () => {
      await createUnitForChairman(
        otherChairman,
        otherSociety,
        createUnitSchema.parse({
          wing: "A",
          flatNumber: "001",
        }),
      );

      const found = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "001" },
      );

      assert.equal(found.total, 1);
      assert.equal(found.units[0].societyId, society);

      const other = await listUnitsForChairman(
        otherChairman,
        otherSociety,
        { page: 1, search: "" },
      );

      assert.equal(other.total, 1);
      assert.equal(other.units[0].societyId, otherSociety);
    });


    await t.test("zero-capacity category is rejected", async () => {
      const before = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "" },
      );

      const forbiddenType = before.unitTypes.find(
        (type) => type.category === "four_plus_bhk",
      );
      assert.ok(forbiddenType);

      const eventsBefore = await pool.query<{ count: number }>(
        "SELECT COUNT(*)::integer AS count FROM unit_events WHERE society_id = $1",
        [society],
      );

      await assert.rejects(
        createUnitForChairman(
          chairman,
          society,
          createUnitSchema.parse({
            wing: "A",
            flatNumber: "zero-capacity-test",
            unitTypeId: forbiddenType.id,
          }),
        ),
        { code: "UNIT_TYPE_LIMIT_REACHED" },
      );

      const after = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "" },
      );

      const eventsAfter = await pool.query<{ count: number }>(
        "SELECT COUNT(*)::integer AS count FROM unit_events WHERE society_id = $1",
        [society],
      );

      assert.equal(after.total, before.total);
      assert.equal(eventsAfter.rows[0].count, eventsBefore.rows[0].count);
    });

    await t.test("concurrent additions respect category capacity", async () => {
      // Earlier tests created one unassigned flat and one 1 BHK flat.
      // Allow exactly one additional 1 BHK while leaving total headroom.
      await pool.query(
        "UPDATE societies SET total_units = 4, one_bhk_units = 2, two_bhk_units = 2 WHERE id = $1",
        [society],
      );

      const before = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "" },
      );

      assert.equal(before.total, 2);

      const oneBhk = before.unitTypes.find(
        (type) => type.category === "one_bhk",
      );
      assert.ok(oneBhk);

      const results = await Promise.allSettled(
        ["capacity-A", "capacity-B"].map((flatNumber) =>
          createUnitForChairman(
            chairman,
            society,
            createUnitSchema.parse({
              wing: "A",
              flatNumber,
              unitTypeId: oneBhk.id,
            }),
          ),
        ),
      );

      const successes = results.filter(
        (result) => result.status === "fulfilled",
      );
      const failures = results.filter(
        (result) => result.status === "rejected",
      );

      assert.equal(successes.length, 1);
      assert.equal(failures.length, 1);
      assert.equal(failures[0].reason.code, "UNIT_TYPE_LIMIT_REACHED");

      const after = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "" },
      );

      assert.equal(after.total, 3);
      assert.equal(
        after.units.filter((unit) => unit.unitTypeId === oneBhk.id).length,
        2,
      );
    });

    await t.test("concurrent additions respect total capacity", async () => {
      const before = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "" },
      );

      assert.equal(before.total, 3);

      const results = await Promise.allSettled(
        ["total-A", "total-B"].map((flatNumber) =>
          createUnitForChairman(
            chairman,
            society,
            createUnitSchema.parse({
              wing: "A",
              flatNumber,
            }),
          ),
        ),
      );

      const successes = results.filter(
        (result) => result.status === "fulfilled",
      );
      const failures = results.filter(
        (result) => result.status === "rejected",
      );

      assert.equal(successes.length, 1);
      assert.equal(failures.length, 1);
      assert.equal(failures[0].reason.code, "UNIT_LIMIT_REACHED");

      const after = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "" },
      );

      const events = await pool.query<{ count: number }>(
        "SELECT COUNT(*)::integer AS count FROM unit_events WHERE society_id = $1",
        [society],
      );

      assert.equal(after.total, 4);
      assert.equal(events.rows[0].count, 4);
    });

    await t.test("invalid fields and injected occupancy are rejected", () => {
      for (const input of [
        { flatNumber: "" },
        { flatNumber: "   " },
        { flatNumber: 1 },
        { flatNumber: "001", wing: "A\nB" },
        { flatNumber: "001", unitTypeId: "invalid" },
        { flatNumber: "001", occupancyStatus: "owner_occupied" },
        { flatNumber: "001", ownerApproved: true },
      ]) {
        assert.equal(createUnitSchema.safeParse(input).success, false);
      }
    });
  } finally {
    try {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM unit_events WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM society_units WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          "DELETE FROM society_unit_types WHERE society_id = ANY($1::uuid[])",
          [societyIds],
        );
        await client.query(
          `DELETE FROM application_events WHERE application_id IN (
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
