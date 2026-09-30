import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromToken, readSessionToken } from "@/lib/server/auth/session";
import { checkRequestOrigin, HttpError, readJsonBody } from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import { applicationInboxFailure } from "@/lib/server/http/application-inbox";
import { tenantReviewSchema } from "@/lib/contracts/tenant-review";
import { listTenantReviews, reviewTenantApplication } from "@/lib/server/services/tenant-applications.service";
export const runtime = "nodejs";
type Context = { params: Promise<{ societyId: string }> };
async function authenticate(request: NextRequest) {
  const session = await getSessionFromToken(readSessionToken(request, "chairman"), "chairman");
  if (!session) throw new HttpError(401, "Sign in to your chairman account.");
  return session.userId;
}
export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await authenticate(request);
    const { societyId } = await context.params;
    const page = z.coerce.number().int().min(1).max(100000).safeParse(request.nextUrl.searchParams.get("page") ?? 1);
    if (!page.success) throw new HttpError(400, "Invalid page.");
    return jsonNoStore(await listTenantReviews(user, societyId, page.data));
  } catch (error) { return applicationInboxFailure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    checkRequestOrigin(request);
    const user = await authenticate(request);
    const { societyId } = await context.params;
    const parsed = tenantReviewSchema.safeParse(await readJsonBody(request, 8192));
    if (!parsed.success || parsed.data.societyId !== societyId) throw new HttpError(400, "Check the application and society.");
    return jsonNoStore({ request: await reviewTenantApplication(user, societyId, parsed.data.requestId, parsed.data.review, "chairman") });
  } catch (error) { return applicationInboxFailure(error); }
}
