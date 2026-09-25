import nextEnv from "@next/env";
import { runner } from "node-pg-migrate";
import { fileURLToPath } from "node:url";

const { loadEnvConfig } = nextEnv;

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

function requiredSetting(name) {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required setting: ${name}`);
  }

  return value;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("This migration command is for local development only.");
  }

  loadEnvConfig(projectDirectory, true);

  const host = requiredSetting("PGHOST");
  const database = requiredSetting("PGDATABASE");
  const portText = requiredSetting("PGPORT");
  const port = Number(portText);

  if (
    !["localhost", "127.0.0.1", "::1"].includes(host) ||
    database !== "leaseiq_societies_dev"
  ) {
    throw new Error(
      "This command must target the local leaseiq_societies_dev database.",
    );
  }

  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
    throw new Error("PGPORT must be a whole number from 1 to 65535.");
  }

  await runner({
    databaseUrl: {
      host,
      port,
      database,
      user: requiredSetting("PGUSER"),
      password: requiredSetting("PGPASSWORD"),
      connectionTimeoutMillis: 5000,
    },
    dir: migrationsDirectory,
    direction: "up",
    migrationsTable: "pgmigrations",
    singleTransaction: true,
    checkOrder: true,
  });

  console.log("Development database migrations completed.");
}

main().catch((error) => {
  console.error(
    "Migration failed:",
    error instanceof Error ? error.message : "Unknown error",
  );

  process.exitCode = 1;
});