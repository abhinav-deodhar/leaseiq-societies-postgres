import "server-only";
import { Pool } from "pg";

const databaseGlobal = globalThis as typeof globalThis & {
  leaseiqPool?: Pool;
};

function requiredSetting(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required database setting: ${name}`);
  }

  return value;
}

export function getDatabase(): Pool {
  if (databaseGlobal.leaseiqPool) {
    return databaseGlobal.leaseiqPool;
  }

  const portText = requiredSetting("PGPORT");
  const port = Number(portText);

  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
    throw new Error("PGPORT must be a whole number from 1 to 65535.");
  }

  const pool = new Pool({
    host: requiredSetting("PGHOST"),
    port,
    database: requiredSetting("PGDATABASE"),
    user: requiredSetting("PGUSER"),
    password: requiredSetting("PGPASSWORD"),
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
  });

  pool.on("error", () => {
    console.error("An idle database connection failed.");
  });

  databaseGlobal.leaseiqPool = pool;
  return pool;
}