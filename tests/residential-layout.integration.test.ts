import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { getDatabase } from "../src/lib/server/db";
import { societyApplicationSchema } from "../src/lib/validation/society";
import {
  insertSociety,
  insertPendingApplication,
  insertSubmissionEvent,
} from "../src/lib/server/repositories/society-application.repository";
import {
  updateApplicationSociety,
} from "../src/lib/server/repositories/application-resubmission.repository";

test(
  "layout persists with calculated aggregates and audit snapshot; corrections update it",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async () => {
    loadEnvConfig(process.cwd(), true);

    assert.ok(
      ["localhost", "127.0.0.1", "::1"].includes(
        process.env.PGHOST ?? "",
      ),
    );
    assert.equal(
      process.env.PGDATABASE,
      "leaseiq_societies_dev",
    );

    const pool = getDatabase();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const userId = randomUUID();

      const applicant = {
        fullName: "Calculator integration test",
        email: `calculator-${userId}@example.com`,
        phone: `+919${randomInt(100000000, 999999999)}`,
      };

      await client.query(
        `INSERT INTO users (id, full_name, email, phone)
         VALUES ($1, $2, $3, $4)`,
        [
          userId,
          applicant.fullName,
          applicant.email,
          applicant.phone,
        ],
      );

      const input = {
        name: "Calculator integration society",
        addressLine1: "123 Test Road",
        addressLine2: "",
        city: "Pune",
        state: "Maharashtra",
        pinCode: "411001",
        residentialLayout: {
          mode: "layout",
          buildingType: "wings",
          wings: [
            {
              name: "A",
              floorGroups: [
                {
                  floors: ["1", "2"],
                  unitsPerFloor: {
                    studioUnits: 0,
                    oneBhkUnits: 1,
                    twoBhkUnits: 2,
                    threeBhkUnits: 0,
                    fourPlusBhkUnits: 0,
                    customUnits: [
                      { name: "Duplex", count: 1 },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };

      const data = societyApplicationSchema.parse(input);
      const societyId = await insertSociety(
        client,
        userId,
        data,
      );

      const application = await insertPendingApplication(
        client,
        societyId,
        userId,
      );

      await insertSubmissionEvent(
        client,
        application.id,
        userId,
        data,
        applicant,
      );

      const saved = (
        await client.query(
          `SELECT total_units, residential_layout
           FROM societies
           WHERE id = $1`,
          [societyId],
        )
      ).rows[0];

      assert.equal(saved.total_units, 8);
      assert.deepEqual(
        saved.residential_layout,
        data.residentialLayout,
      );

      const snapshot = (
        await client.query(
          `SELECT application_snapshot
           FROM application_events
           WHERE application_id = $1`,
          [application.id],
        )
      ).rows[0].application_snapshot;

      assert.deepEqual(
        snapshot.society.residentialLayout,
        data.residentialLayout,
      );

      input.residentialLayout.wings[0]
        .floorGroups[0].floors.push("3");

      const corrected = societyApplicationSchema.parse(input);

      await updateApplicationSociety(
        client,
        societyId,
        corrected,
      );

      const updated = (
        await client.query(
          `SELECT total_units, residential_layout
           FROM societies
           WHERE id = $1`,
          [societyId],
        )
      ).rows[0];

      assert.equal(updated.total_units, 12);
      assert.deepEqual(
        updated.residential_layout,
        corrected.residentialLayout,
      );
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
        await pool.end();
      }
    }
  },
);