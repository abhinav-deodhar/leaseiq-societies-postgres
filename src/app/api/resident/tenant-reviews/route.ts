import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromToken, readSessionToken } from "@/lib/server/auth/session";
import { checkRequestOrigin, HttpError, readJsonBody } from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import { applicationInboxFailure } from "@/lib/server/http/application-inbox";
import { tenantReviewSchema } from "@/lib/contracts/tenant-review";
import { listTenantReviews, reviewTenantApplication } from "@/lib/server/services/tenant-applications.service";
export const runtime = "nodejs";
async function authenticate(request: NextRequest) {
  const session = await getSessionFromToken(readSessionToken(request, "resident"), "resident");
  if (!session) throw new HttpError(401, "Sign in to your resident account.");
  return session.userId;
}
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    const page = z.coerce.number().int().min(1).max(100000).safeParse(request.nextUrl.searchParams.get("page") ?? 1);
    if (!page.success) throw new HttpError(400, "Invalid page.");
    return jsonNoStore(await listTenantReviews(user, null, page.data));
  } catch (error) { return applicationInboxFailure(error); }
}
export async function POST(request: NextRequest) {
  try {
    checkRequestOrigin(request);
    const user = await authenticate(request);
    const parsed = tenantReviewSchema.safeParse(await readJsonBody(request, 8192));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check your decision.");
    const { societyId, requestId, review } = parsed.data;
    return jsonNoStore({ request: await reviewTenantApplication(user, societyId, requestId, review, "owner") });
  } catch (error) { return applicationInboxFailure(error); }
}
