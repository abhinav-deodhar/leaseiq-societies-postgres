import { createRequire } from "node:module";
import { getDatabase } from "../src/lib/server/db";
import {
  findDueInvoiceSchedules,
  processInvoiceSchedule,
} from "../src/lib/server/services/invoice-schedule-runner.service";

const { loadEnvConfig } = createRequire(import.meta.url)(
  "@next/env",
) as typeof import("@next/env");

async function main() {
  const args = process.argv.slice(2);

  if (
    args.length > 1 ||
    (args.length === 1 && !["--preview", "--execute"].includes(args[0]))
  ) {
    throw new Error("Use --preview or --execute.");
  }

  const execute = args[0] === "--execute";
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

  const totals = {
    candidates: 0,
    generatedBills: 0,
    skippedMonths: 0,
    blocked: 0,
    failed: 0,
  };

  console.log(execute ? "EXECUTION MODE" : "READ-ONLY PREVIEW");
  let cursor: string | null = null;

  // Bound each invocation. Another invocation can continue remaining work.
  for (let page = 0; page < 100; page += 1) {
    const schedules = await findDueInvoiceSchedules(cursor, 50);

    if (schedules.length === 0) break;

    for (const schedule of schedules) {
      totals.candidates += 1;

      if (!execute) {
        console.log({
          scheduleId: schedule.id,
          societyId: schedule.societyId,
          nextBillingMonth: schedule.nextBillingMonth,
        });
        continue;
      }

      try {
        const result = await processInvoiceSchedule(
          schedule.societyId,
          schedule.id,
        );

        totals.generatedBills += result.invoiceCount;
        totals.skippedMonths += result.skippedMonths;
        if (result.outcome === "blocked") totals.blocked += 1;

        console.log(result);
      } catch (error) {
        totals.failed += 1;
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "RUN_FAILED";

        console.error({ scheduleId: schedule.id, code });
      }
    }

    cursor = schedules[schedules.length - 1].id;

    if (schedules.length < 50) break;

    if (page === 99) {
      console.log("Invocation limit reached; more schedules may remain.");
    }
  }

  console.log(totals);

  if (totals.failed > 0) process.exitCode = 1;
}

main()
  .catch(() => {
    console.error("Runner could not complete. Check configuration and database access.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDatabase().end();
  });
