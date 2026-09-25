import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import {
  checkRequestOrigin,
  HttpError,
  readJsonBody,
} from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import { SocietyAccessError } from "@/lib/server/services/society-access.service";
import { InvoiceDraftError } from "@/lib/server/services/invoice-drafts.service";
import {
  prepareInvoiceIssue,
  issueInvoiceDraft,
} from "@/lib/server/services/invoice-issuance.service";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ societyId: string; draftId: string }>;
};

const paramsSchema = z.strictObject({
  societyId: z.uuid(),
  draftId: z.uuid(),
});

function failure(error: unknown): Response {
  if (error instanceof SocietyAccessError) {
    return jsonNoStore(
      { code: error.code, message: error.message },
      403,
    );
  }

  if (error instanceof InvoiceDraftError) {
    return jsonNoStore(
      { code: error.code, message: error.message },
      error.status,
    );
  }

  if (error instanceof HttpError) {
    return jsonNoStore({ message: error.message }, error.status);
  }

  if (error instanceof z.ZodError) {
    return jsonNoStore(
      { message: "Send valid invoice review details." },
      400,
    );
  }

  console.error("Invoice issuance request failed.");

  return jsonNoStore(
    {
      message:
        "Unable to complete this request. Retry to check the result safely.",
    },
    503,
  );
}

async function authenticatedContext(
  request: NextRequest,
  context: Context,
) {
  const session = await getSessionFromToken(
    readSessionToken(request, "chairman"),
    "chairman",
  );

  if (!session) {
    throw new HttpError(401, "Sign in to your chairman account.");
  }

  return {
    session,
    params: paramsSchema.parse(await context.params),
  };
}

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    const { session, params } = await authenticatedContext(
      request,
      context,
    );

    return jsonNoStore(
      await prepareInvoiceIssue(
        session.userId,
        params.societyId,
        params.draftId,
      ),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    checkRequestOrigin(request);

    const { session, params } = await authenticatedContext(
      request,
      context,
    );

    const result = await issueInvoiceDraft(
      session.userId,
      params.societyId,
      params.draftId,
      await readJsonBody(request, 4096),
    );

    return jsonNoStore(result, result.replayed ? 200 : 201);
  } catch (error) {
    return failure(error);
  }
}
