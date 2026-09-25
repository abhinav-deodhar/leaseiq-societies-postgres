import { z } from "zod";
import { checkRequestOrigin, HttpError, readJsonBody } from "@/lib/server/http";
import { updateInvoiceDraft } from "@/lib/server/services/invoice-drafts.service";
import { deleteInvoiceDraft } from "@/lib/server/services/invoice-draft-deletion.service";
import type { NextRequest } from "next/server";
import { societyIdSchema } from "@/lib/contracts/units";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import { jsonNoStore } from "@/lib/server/http/json";
import { SocietyAccessError } from "@/lib/server/services/society-access.service";
import { InvoiceDraftError } from "@/lib/server/services/invoice-drafts.service";
import { getInvoiceDraft } from "@/lib/server/services/invoice-draft-reading.service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ societyId: string; draftId: string }> },
): Promise<Response> {
  try {
    const session = await getSessionFromToken(
      readSessionToken(request, "chairman"),
      "chairman",
    );
    if (!session) {
      return jsonNoStore({ message: "Sign in to your chairman account." }, 401);
    }

    const params = await context.params;
    const society = societyIdSchema.safeParse(params.societyId);
    const draft = societyIdSchema.safeParse(params.draftId);

    if (!society.success || !draft.success) {
      return jsonNoStore({ message: "Choose a valid society and draft." }, 400);
    }

    return jsonNoStore(
      await getInvoiceDraft(session.userId, society.data, draft.data),
    );
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ message: error.message }, 403);
    }
    if (error instanceof InvoiceDraftError) {
      return jsonNoStore(
        { code: error.code, message: error.message },
        error.status,
      );
    }
    console.error("Invoice draft lookup failed.");
    return jsonNoStore({ message: "Unable to load this invoice draft." }, 503);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ societyId: string; draftId: string }> }): Promise<Response> {
  try {
    checkRequestOrigin(request);
    const session = await getSessionFromToken(readSessionToken(request, "chairman"), "chairman");
    if (!session) return jsonNoStore({ message: "Sign in to your chairman account." }, 401);
    const params = await context.params;
    const society = societyIdSchema.safeParse(params.societyId);
    const draft = societyIdSchema.safeParse(params.draftId);
    if (!society.success || !draft.success) return jsonNoStore({ message: "Choose a valid society and draft." }, 400);
    return jsonNoStore(await deleteInvoiceDraft(session.userId, society.data, draft.data));
  } catch (error) {
    if (error instanceof HttpError || error instanceof InvoiceDraftError) return jsonNoStore({ message: error.message }, error.status);
    if (error instanceof SocietyAccessError) return jsonNoStore({ message: error.message }, 403);
    console.error("Invoice draft deletion failed.");
    return jsonNoStore({ message: "Unable to delete the draft. Please retry." }, 503);
  }
}


export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ societyId: string; draftId: string }> },
): Promise<Response> {
  try {
    checkRequestOrigin(request);

    const session = await getSessionFromToken(
      readSessionToken(request, "chairman"),
      "chairman",
    );
    if (!session) {
      return jsonNoStore({ message: "Sign in to your chairman account." }, 401);
    }

    const params = await context.params;
    const society = societyIdSchema.safeParse(params.societyId);
    const draft = societyIdSchema.safeParse(params.draftId);

    if (!society.success || !draft.success) {
      return jsonNoStore({ message: "Choose a valid society and draft." }, 400);
    }

    return jsonNoStore(
      await updateInvoiceDraft(
        session.userId,
        society.data,
        draft.data,
        await readJsonBody(request, 65536),
      ),
    );
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ message: error.message }, 403);
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
        {
          message: "Check the draft details.",
          errors: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    console.error("Invoice draft update failed.");
    return jsonNoStore(
      { message: "Saving was not confirmed. Retry the same request safely." },
      503,
    );
  }
}
