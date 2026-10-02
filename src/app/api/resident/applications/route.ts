import { deleteResidentDraft } from "@/lib/server/services/resident-requests.service";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromToken, readSessionToken } from "@/lib/server/auth/session";
import { checkRequestOrigin, HttpError, readJsonBody } from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import {
  applicationInboxFailure, applicationInboxFilters,
} from "@/lib/server/http/application-inbox";
import { submitResidentApplication } from "@/lib/server/services/tenant-applications.service";
import { listApplicationInbox } from "@/lib/server/services/owner-application-review.service";
import { residentRequestSubmissionSchema } from "@/lib/contracts/resident-associations";

export const runtime = "nodejs";

async function authenticate(request: NextRequest) {
  const session = await getSessionFromToken(
    readSessionToken(request, "resident"), "resident",
  );
  if (!session) throw new HttpError(401, "Sign in to your resident account.");
  return session;
}

export async function GET(request: NextRequest) {
  try {
    const session = await authenticate(request);
    return jsonNoStore(await listApplicationInbox(
      session.userId, null, {
        ...applicationInboxFilters(request.nextUrl.searchParams),
        scope: request.nextUrl.searchParams.get("scope") ?? "all",
        stage: request.nextUrl.searchParams.get("stage") ?? "all",
      },
    ));
  } catch (error) { return applicationInboxFailure(error); }
}

const submission = residentRequestSubmissionSchema.extend({
  societyId: z.uuid(), requestId: z.uuid(),
});

export async function POST(request: NextRequest) {
  try {
    checkRequestOrigin(request);
    const session = await authenticate(request);
    const input = submission.safeParse(await readJsonBody(request, 4096));
    if (!input.success) throw new HttpError(400, "Reload and check the application.");
    const data = input.data;
    return jsonNoStore({ request: await submitResidentApplication(
      session.userId, data.societyId, data.requestId, data.expectedRevision,
    ) });
  } catch (error) { return applicationInboxFailure(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    checkRequestOrigin(request);
    const session=await authenticate(request);
    const input=submission.safeParse(await readJsonBody(request,4096));
    if(!input.success) throw new HttpError(400,"Reload and check the draft.");
    return jsonNoStore(await deleteResidentDraft(session.userId,input.data.societyId,input.data.requestId,input.data.expectedRevision));
  } catch(error) { return applicationInboxFailure(error); }
}
