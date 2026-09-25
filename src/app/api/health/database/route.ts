import { getDatabase } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await getDatabase().query("SELECT 1");

    return Response.json(
      { status: "ok", database: "connected" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error("Database health check failed.");

    return Response.json(
      { status: "error", database: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
