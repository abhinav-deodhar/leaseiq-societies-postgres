import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import type { NextRequest } from "next/server";
import { submitSocietyApplication } from "@/lib/server/services/society-application.service";
import { ApplicationError } from "@/lib/server/services/application-error";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import {
  checkRequestOrigin,
  HttpError,
  readJsonBody,
} from "@/lib/server/http";
import { societyApplicationSchema } from "@/lib/validation/society";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  try {
    checkRequestOrigin(request);

    const session = await getSessionFromToken(
      readSessionToken(request, "chairman"),
      "chairman",
    );

    if (!session) {
      return json({ message: "Sign in to your chairman account." }, 401);
    }

    const validation = societyApplicationSchema.safeParse(
      await readJsonBody(request, 262144),
    );

    if (!validation.success) {
      return json(
        {
          message: "Please correct the application details.",
          errors: validation.error.issues.map((issue) => ({
            field: issue.path.join(".") || "form",
            message: issue.message,
          })),
        },
        400,
      );
    }

    const application = await submitSocietyApplication(session.userId, validation.data);
    return json({ message: "Your society application has been submitted for review.", application }, 201);
  } catch (error) {
    if (error instanceof ApplicationError) {
      return json({ message: error.message }, error.code === "APPLICATION_EXISTS" ? 409 : 403);
    }
    if (error instanceof HttpError) {
      return json({ message: error.message }, error.status);
    }

    console.error("Society application submission failed.");

    return json(
      { message: "Unable to submit your application. Please try again." },
      500,
    );
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getSessionFromToken(
      readSessionToken(request, "chairman"),
      "chairman",
    );

    if (!session) {
      return json({ message: "Sign in to your chairman account." }, 401);
    }

    const application = await getChairmanApplication(session.userId);

    return json({ application }, 200);
  } catch {
    console.error("Chairman application lookup failed.");

    return json(
      { message: "Unable to load your society. Please try again." },
      503,
    );
  }
}
