import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromToken, readSessionToken } from "@/lib/server/auth/session";
import { HttpError, checkRequestOrigin, readJsonBody } from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import { applicationInboxFailure } from "@/lib/server/http/application-inbox";
import { ownerOccupancyUpdateSchema } from "@/lib/contracts/occupancy";
import { ownerOccupancy } from "@/lib/server/services/owner-occupancy.service";

export const runtime = "nodejs";
async function user(request: NextRequest) {
  const session = await getSessionFromToken(readSessionToken(request, "resident"), "resident");
  if (!session) throw new HttpError(401, "Sign in to your resident account.");
  return session.userId;
}
export async function GET(request: NextRequest) {
  try {
    const id = await user(request);
    const parsed = z.object({ societyId: z.uuid(), unitId: z.uuid() }).safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new HttpError(400, "Choose a valid flat.");
    return jsonNoStore(await ownerOccupancy(id, parsed.data.societyId, parsed.data.unitId));
  } catch (error) { return applicationInboxFailure(error); }
}
export async function POST(request: NextRequest) {
  try {
    checkRequestOrigin(request);
    const id = await user(request);
    const parsed = ownerOccupancyUpdateSchema.safeParse(await readJsonBody(request, 4096));
    if (!parsed.success) throw new HttpError(400, "Choose a valid occupancy and reload the flat's revision.");
    return jsonNoStore(await ownerOccupancy(id, parsed.data.societyId, parsed.data.unitId, parsed.data));
  } catch (error) { return applicationInboxFailure(error); }
}
