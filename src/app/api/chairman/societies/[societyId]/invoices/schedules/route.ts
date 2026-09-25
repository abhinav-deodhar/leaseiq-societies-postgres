import { listInvoiceSchedules } from "@/lib/server/services/invoice-schedule-reading.service";
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
import { SocietyAccessError } from "@/lib/server/services/society-access.service";
import {
  createInvoiceSchedule,
  InvoiceScheduleError,
} from "@/lib/server/services/invoice-schedules.service";

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

    const result = await createInvoiceSchedule(
      session.userId,
      society.data,
      await readJsonBody(request, 32768),
    );

    return jsonNoStore(
      {
        ...result,
        message: result.replayed
          ? "This schedule request was already processed."
          : "Schedule draft saved. Automatic billing has not been activated.",
      },
      result.replayed ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonNoStore(
        {
          message: "Correct the schedule details.",
          errors: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ message: error.message }, 403);
    }
    if (error instanceof InvoiceScheduleError) {
      return jsonNoStore(
        { code: error.code, message: error.message },
        error.status,
      );
    }
    if (error instanceof HttpError) {
      return jsonNoStore({ message: error.message }, error.status);
    }

    console.error("Invoice schedule creation failed.");
    return jsonNoStore(
      {
        message:
          "Unable to confirm schedule creation. Retry using the same request key.",
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
      readSessionToken(request, "chairman"), "chairman",
    );
    if (!session) {
      return jsonNoStore({ message: "Sign in to your chairman account." }, 401);
    }

    const society = societyIdSchema.safeParse((await context.params).societyId);
    const page = request.nextUrl.searchParams.get("page") ?? "1";
    if (!society.success || !/^[1-9][0-9]{0,5}$/.test(page)) {
      return jsonNoStore({ message: "Choose a valid society and page." }, 400);
    }

    return jsonNoStore(
      await listInvoiceSchedules(session.userId, society.data, Number(page)),
    );
  } catch (error) {
    if (error instanceof SocietyAccessError) {
      return jsonNoStore({ message: error.message }, 403);
    }
    console.error("Invoice schedule listing failed.");
    return jsonNoStore({ message: "Unable to load recurring schedules." }, 503);
  }
}
