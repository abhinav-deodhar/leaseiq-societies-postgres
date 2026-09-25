import { unitImportSchema } from "../src/lib/contracts/unit-import";
import { importUnitsForChairman } from "../src/lib/server/services/unit-import.service";
import {
  createUnitInTransaction,
  withChairmanUnitAccess,
} from "../src/lib/server/services/units.service";
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

test("unit import validation and transactions", async (t) => {
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


    async function counts(societyId: string) {
      const result = await pool.query<{
        units: number;
        events: number;
      }>(
        `SELECT
          (SELECT COUNT(*)::integer FROM society_units
           WHERE society_id = $1) AS units,
          (SELECT COUNT(*)::integer FROM unit_events
           WHERE society_id = $1) AS events`,
        [societyId],
      );
      return result.rows[0];
    }

    async function makeRows(
      societyId: string,
      numbers: string[],
      category = "one_bhk",
    ) {
      const register = await listUnitsForChairman(
        chairman,
        societyId,
        { page: 1, search: "" },
      );
      const type = register.unitTypes.find(
        (item) => item.category === category,
      );
      assert.ok(type);

      return numbers.map((flatNumber) =>
        createUnitSchema.parse({
          wing: "A",
          floorLabel: "1",
          flatNumber,
          unitTypeId: type.id,
        }),
      );
    }

    await t.test("preview creates no units or audit events", async () => {
      const rows = await makeRows(society, ["001", "002"]);
      const before = await counts(society);

      const result = await importUnitsForChairman(chairman, society, {
        mode: "preview",
        rows,
      });

      assert.equal(result.valid, true);
      assert.equal(result.imported, 0);
      assert.equal(result.rowCount, 2);
      assert.deepEqual(result.issues, []);
      assert.deepEqual(await counts(society), before);
    });

    await t.test("valid import preserves zeros and creates audit records", async () => {
      const rows = await makeRows(society, ["001", "002"]);
      const result = await importUnitsForChairman(chairman, society, {
        mode: "import",
        rows,
      });

      assert.equal(result.valid, true);
      assert.equal(result.imported, 2);
      assert.deepEqual(await counts(society), { units: 2, events: 2 });

      const register = await listUnitsForChairman(
        chairman,
        society,
        { page: 1, search: "" },
      );
      assert.deepEqual(
        register.units.map((unit) => unit.flatNumber),
        ["001", "002"],
      );
      assert.ok(
        register.units.every(
          (unit) =>
            unit.occupancyStatus === "unknown" &&
            unit.revision === 1,
        ),
      );

      const events = await pool.query<{
        actor: string;
        action: string;
        snapshot: { flatNumber: string };
      }>(
        `SELECT actor_user_id AS actor, action, snapshot
         FROM unit_events WHERE society_id = $1`,
        [society],
      );
      assert.ok(events.rows.every(
        (event) => event.actor === chairman && event.action === "created",
      ));
      assert.deepEqual(
        events.rows.map((event) => event.snapshot.flatNumber).sort(),
        ["001", "002"],
      );
    });

    await t.test("existing duplicate rejects the whole batch", async () => {
      const before = await counts(society);
      const rows = await makeRows(society, ["003", "001"]);

      const result = await importUnitsForChairman(chairman, society, {
        mode: "import",
        rows,
      });

      assert.equal(result.valid, false);
      assert.equal(result.imported, 0);
      assert.ok(result.issues.some((issue) => issue.row === 3));
      assert.deepEqual(await counts(society), before);
    });

    await t.test("duplicate rows use normalized wing and flat identity", async () => {
      const fresh = await createSociety(chairman, admin);
      const rows = await makeRows(fresh, ["003", "003"]);
      rows[1] = {
        ...rows[1],
        wing: " a ",
        floorLabel: "2",
      };

      const result = await importUnitsForChairman(chairman, fresh, {
        mode: "import",
        rows,
      });

      assert.equal(result.valid, false);
      assert.ok(result.issues.some(
        (issue) => issue.row === 3 && issue.message.includes("duplicates"),
      ));
      assert.deepEqual(await counts(fresh), { units: 0, events: 0 });
    });

    await t.test("total and category limits reject complete batches", async () => {
      const fresh = await createSociety(chairman, admin);
      await pool.query(
        `UPDATE societies
         SET total_units = 2, one_bhk_units = 1, two_bhk_units = 1
         WHERE id = $1`,
        [fresh],
      );

      const rows = await makeRows(fresh, ["001", "002"]);
      const categoryResult = await importUnitsForChairman(chairman, fresh, {
        mode: "import",
        rows,
      });

      assert.equal(categoryResult.valid, false);
      assert.ok(categoryResult.issues.some(
        (issue) => issue.message.includes("unit category"),
      ));
      assert.deepEqual(await counts(fresh), { units: 0, events: 0 });

      const totalResult = await importUnitsForChairman(chairman, fresh, {
        mode: "import",
        rows: ["001", "002", "003"].map((flatNumber) =>
          createUnitSchema.parse({ wing: "A", flatNumber }),
        ),
      });

      assert.equal(totalResult.valid, false);
      assert.ok(totalResult.issues.some(
        (issue) => issue.message.includes("approved total"),
      ));
      assert.deepEqual(await counts(fresh), { units: 0, events: 0 });
    });

    await t.test("preview does not reserve capacity", async () => {
      const fresh = await createSociety(chairman, admin);
      await pool.query(
        `UPDATE societies SET total_units = 1, one_bhk_units = 1
         WHERE id = $1`,
        [fresh],
      );
      const rows = await makeRows(fresh, ["001"]);

      const preview = await importUnitsForChairman(chairman, fresh, {
        mode: "preview",
        rows,
      });
      assert.equal(preview.valid, true);

      await createUnitForChairman(
        chairman,
        fresh,
        createUnitSchema.parse({ wing: "A", flatNumber: "002" }),
      );

      const result = await importUnitsForChairman(chairman, fresh, {
        mode: "import",
        rows,
      });
      assert.equal(result.valid, false);
      assert.equal(result.imported, 0);
      assert.deepEqual(await counts(fresh), { units: 1, events: 1 });
    });

    await t.test("society access and foreign unit types are rejected", async () => {
      const rows = await makeRows(society, ["004"]);
      const before = await counts(society);

      for (const mode of ["preview", "import"] as const) {
        await assert.rejects(
          importUnitsForChairman(otherChairman, society, { mode, rows }),
          { code: "FORBIDDEN" },
        );
        await assert.rejects(
          importUnitsForChairman(admin, society, { mode, rows }),
          { code: "FORBIDDEN" },
        );
      }

      const foreign = await listUnitsForChairman(
        otherChairman,
        otherSociety,
        { page: 1, search: "" },
      );

      const result = await importUnitsForChairman(chairman, society, {
        mode: "import",
        rows: [{
          ...rows[0],
          unitTypeId: foreign.unitTypes[0].id,
        }],
      });

      assert.equal(result.valid, false);
      assert.equal(result.imported, 0);
      assert.deepEqual(await counts(society), before);
    });

    await t.test("transaction failure rolls back units and audit events", async () => {
      const fresh = await createSociety(chairman, admin);
      const rows = await makeRows(fresh, ["001", "002"]);
      const failure = new Error("Deliberate test failure after writes");

      await assert.rejects(
        withChairmanUnitAccess(chairman, fresh, async (client) => {
          for (const row of rows) {
            await createUnitInTransaction(client, chairman, fresh, row);
          }

          const inside = await client.query<{ count: number }>(
            `SELECT COUNT(*)::integer AS count
             FROM society_units WHERE society_id = $1`,
            [fresh],
          );
          assert.equal(inside.rows[0].count, 2);
          throw failure;
        }),
        (error: unknown) => error === failure,
      );

      assert.deepEqual(await counts(fresh), { units: 0, events: 0 });
    });

    await t.test("competing imports cannot overfill the society", async () => {
      const fresh = await createSociety(chairman, admin);
      const first = await makeRows(
        fresh,
        ["101", "102", "103", "104", "105", "106"],
      );
      const second = await makeRows(
        fresh,
        ["201", "202", "203", "204", "205", "206"],
      );

      const results = await Promise.all([
        importUnitsForChairman(chairman, fresh, {
          mode: "import", rows: first,
        }),
        importUnitsForChairman(chairman, fresh, {
          mode: "import", rows: second,
        }),
      ]);

      assert.equal(results.filter((result) => result.valid).length, 1);
      assert.equal(results.filter((result) => !result.valid).length, 1);
      assert.equal(
        results.reduce((total, result) => total + result.imported, 0),
        6,
      );
      assert.deepEqual(await counts(fresh), { units: 6, events: 6 });
    });

    await t.test("import contract rejects invalid batch sizes and extra fields", () => {
      const row = { flatNumber: "001" };

      for (const input of [
        { mode: "import", rows: [] },
        { mode: "import", rows: Array.from({ length: 501 }, () => row) },
        { mode: "delete", rows: [row] },
        { mode: "import", rows: [{ ...row, occupancyStatus: "rented" }] },
        { mode: "import", rows: [{ flatNumber: 1 }] },
      ]) {
        assert.equal(unitImportSchema.safeParse(input).success, false);
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
