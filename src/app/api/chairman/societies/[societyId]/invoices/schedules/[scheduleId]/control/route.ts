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
import { InvoiceScheduleError } from "@/lib/server/services/invoice-schedules.service";
import {
  prepareScheduleControl,
  controlInvoiceSchedule,
} from "@/lib/server/services/invoice-schedule-control.service";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ societyId: string; scheduleId: string }>;
};

const paramsSchema = z.strictObject({
  societyId: z.uuid(),
  scheduleId: z.uuid(),
});

async function authenticate(request: NextRequest, context: Context) {
  const session = await getSessionFromToken(
    readSessionToken(request, "chairman"),
    "chairman",
  );

  if (!session) {
    throw new HttpError(401, "Sign in to your chairman account.");
  }

  return {
    userId: session.userId,
    ...paramsSchema.parse(await context.params),
  };
}

function failure(error: unknown) {
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
  if (error instanceof z.ZodError) {
    return jsonNoStore({ message: "Send valid schedule action details." }, 400);
  }

  console.error("Recurring schedule action failed.");
  return jsonNoStore(
    { message: "Unable to confirm this action. Please retry." },
    503,
  );
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { userId, societyId, scheduleId } = await authenticate(request, context);

    return jsonNoStore(
      await prepareScheduleControl(
        userId,
        societyId,
        scheduleId,
        request.nextUrl.searchParams.get("action"),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    checkRequestOrigin(request);
    const { userId, societyId, scheduleId } = await authenticate(request, context);

    return jsonNoStore(
      await controlInvoiceSchedule(
        userId,
        societyId,
        scheduleId,
        await readJsonBody(request, 4096),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
