import { checkRequestOrigin, HttpError } from "@/lib/server/http";
import { deleteScheduleDraft } from "@/lib/server/services/invoice-draft-deletion.service";
import { InvoiceDraftError } from "@/lib/server/services/invoice-drafts.service";
import type { NextRequest } from "next/server";
import { societyIdSchema } from "@/lib/contracts/units";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import { jsonNoStore } from "@/lib/server/http/json";
import { SocietyAccessError } from "@/lib/server/services/society-access.service";
import { InvoiceScheduleError } from "@/lib/server/services/invoice-schedules.service";
import { getInvoiceSchedule } from "@/lib/server/services/invoice-schedule-reading.service";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ societyId: string; scheduleId: string }> },
): Promise<Response> {
  try {
    const session = await getSessionFromToken(
      readSessionToken(request, "chairman"), "chairman",
    );
    if (!session) {
      return jsonNoStore({ message: "Sign in to your chairman account." }, 401);
    }

    const params = await context.params;
    const society = societyIdSchema.safeParse(params.societyId);
    const schedule = societyIdSchema.safeParse(params.scheduleId);
    if (!society.success || !schedule.success) {
      return jsonNoStore({ message: "Choose a valid society and schedule." }, 400);
    }

    return jsonNoStore(
      await getInvoiceSchedule(session.userId, society.data, schedule.data),
    );
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ message: error.message }, 403);
    }
    if (error instanceof InvoiceScheduleError) {
      return jsonNoStore(
        { code: error.code, message: error.message }, error.status,
      );
    }
    console.error("Invoice schedule lookup failed.");
    return jsonNoStore({ message: "Unable to load this recurring schedule." }, 503);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ societyId: string; scheduleId: string }> }): Promise<Response> {
  try {
    checkRequestOrigin(request);
    const session = await getSessionFromToken(readSessionToken(request, "chairman"), "chairman");
    if (!session) return jsonNoStore({ message: "Sign in to your chairman account." }, 401);
    const params = await context.params;
    const society = societyIdSchema.safeParse(params.societyId);
    const draft = societyIdSchema.safeParse(params.scheduleId);
    if (!society.success || !draft.success) return jsonNoStore({ message: "Choose a valid society and draft." }, 400);
    return jsonNoStore(await deleteScheduleDraft(session.userId, society.data, draft.data));
  } catch (error) {
    if (error instanceof HttpError || error instanceof InvoiceDraftError) return jsonNoStore({ message: error.message }, error.status);
    if (error instanceof SocietyAccessError) return jsonNoStore({ message: error.message }, 403);
    console.error("Invoice draft deletion failed.");
    return jsonNoStore({ message: "Unable to delete the draft. Please retry." }, 503);
  }
}
