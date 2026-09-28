import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromToken, readSessionToken } from "@/lib/server/auth/session";
import { checkRequestOrigin, HttpError, readJsonBody } from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import {
  applicationInboxFailure, applicationInboxFilters,
} from "@/lib/server/http/application-inbox";
import {
  listApplicationInbox, reviewOwnerApplication,
} from "@/lib/server/services/owner-application-review.service";
import { residentRequestReviewSchema } from "@/lib/contracts/resident-associations";

export const runtime = "nodejs";
type Context = { params: Promise<{ societyId: string }> };

async function authenticate(request: NextRequest) {
  const session = await getSessionFromToken(
    readSessionToken(request, "chairman"), "chairman",
  );
  if (!session) throw new HttpError(401, "Sign in to your chairman account.");
  return session;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await authenticate(request);
    const { societyId } = await context.params;
    return jsonNoStore(await listApplicationInbox(
      session.userId, societyId, applicationInboxFilters(request.nextUrl.searchParams),
    ));
  } catch (error) { return applicationInboxFailure(error); }
}

const review = z.strictObject({
  requestId: z.uuid(),
  review: residentRequestReviewSchema,
});

export async function POST(request: NextRequest, context: Context) {
  try {
    checkRequestOrigin(request);
    const session = await authenticate(request);
    const { societyId } = await context.params;
    const parsed = review.safeParse(await readJsonBody(request, 8192));
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check your decision.");
    }
    return jsonNoStore({ request: await reviewOwnerApplication(
      session.userId, societyId, parsed.data.requestId, parsed.data.review,
    ) });
  } catch (error) { return applicationInboxFailure(error); }
}
