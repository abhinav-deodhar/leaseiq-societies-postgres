import { listInvoiceDrafts } from "@/lib/server/services/invoice-draft-reading.service";
import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { societyIdSchema } from "@/lib/contracts/units";
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
import {
  SocietyAccessError,
} from "@/lib/server/services/society-access.service";
import {
  createInvoiceDraft,
  InvoiceDraftError,
} from "@/lib/server/services/invoice-drafts.service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ societyId: string }> },
): Promise<Response> {
  try {
    checkRequestOrigin(request);

    const session = await getSessionFromToken(
      readSessionToken(request, "chairman"),
      "chairman",
    );

    if (!session) {
      return jsonNoStore(
        { message: "Sign in to your chairman account." },
        401,
      );
    }

    const params = await context.params;
    const society = societyIdSchema.safeParse(params.societyId);

    if (!society.success) {
      return jsonNoStore({ message: "Choose a valid society." }, 400);
    }

    const result = await createInvoiceDraft(
      session.userId,
      society.data,
      await readJsonBody(request, 32768),
    );

    return jsonNoStore(
      {
        ...result,
        message: result.replayed
          ? "This draft request was already processed."
          : "Draft saved. No invoices have been issued.",
      },
      result.replayed ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonNoStore(
        {
          message: "Correct the invoice details.",
          errors: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

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

    console.error("Invoice draft creation failed.");

    return jsonNoStore(
      {
        message:
          "Unable to confirm draft creation. Retry using the same request key.",
      },
      503,
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ societyId: string }> },
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
    const page = request.nextUrl.searchParams.get("page") ?? "1";

    if (!society.success || !/^[1-9][0-9]{0,5}$/.test(page)) {
      return jsonNoStore({ message: "Choose a valid society and page." }, 400);
    }

    return jsonNoStore(
      await listInvoiceDrafts(session.userId, society.data, Number(page)),
    );
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ message: error.message }, 403);
    }
    console.error("Invoice draft listing failed.");
    return jsonNoStore({ message: "Unable to load invoice drafts." }, 503);
  }
}
