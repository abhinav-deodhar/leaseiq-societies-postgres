import { runner } from "node-pg-migrate";
import { fileURLToPath } from "node:url";

function requiredSetting(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required setting: ${name}`);
  }
  return value;
}

async function main() {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("This command requires NODE_ENV=production.");
  }

  requiredSetting("RAILWAY_ENVIRONMENT_ID");

  const host = requiredSetting("PGHOST");
  const portText = requiredSetting("PGPORT");
  const port = Number(portText);

  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
    throw new Error("PGPORT must be a valid port number.");
  }

  if (!host.endsWith(".railway.internal")) {
    throw new Error("Use the Railway PostgreSQL private-network host.");
  }

  await runner({
    databaseUrl: {
      host,
      port,
      database: requiredSetting("PGDATABASE"),
      user: requiredSetting("PGUSER"),
      password: requiredSetting("PGPASSWORD"),
      connectionTimeoutMillis: 10000,
    },
    dir: fileURLToPath(new URL("../migrations/", import.meta.url)),
    direction: "up",
    migrationsTable: "pgmigrations",
    singleTransaction: true,
    checkOrder: true,
  });

  console.log("Production database migrations completed.");
}

main().catch((error) => {
  console.error(
    "Production migration failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
