import type { NextRequest } from "next/server";
import { getSessionFromToken, readSessionToken } from "@/lib/server/auth/session";
import { jsonNoStore } from "@/lib/server/http/json";
import { loadResidentDashboard } from "@/lib/server/services/resident-dashboard.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromToken(
      readSessionToken(request, "resident"), "resident",
    );
    if (!session) return jsonNoStore({ message: "Please sign in again." }, 401);
    return jsonNoStore(await loadResidentDashboard(session.userId));
  } catch {
    console.error("Resident dashboard lookup failed.");
    return jsonNoStore({
      message: "Unable to load your dashboard. Please try again.",
    }, 503);
  }
}
