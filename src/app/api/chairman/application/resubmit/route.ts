import type { NextRequest } from "next/server";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import {
  checkRequestOrigin,
  HttpError,
  readJsonBody,
} from "@/lib/server/http";
import { applicationResubmissionSchema } from "@/lib/validation/application-resubmission";
import {
  ApplicationResubmissionError,
  resubmitSocietyApplication,
} from "@/lib/server/services/application-resubmission.service";

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
      return json(
        { message: "Sign in to your chairman account." },
        401,
      );
    }

    const validation = applicationResubmissionSchema.safeParse(
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

    const application = await resubmitSocietyApplication(
      session.userId,
      validation.data,
    );

    return json(
      {
        message: "Your updated application has been sent for review.",
        application,
      },
      200,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ message: error.message }, error.status);
    }

    if (error instanceof ApplicationResubmissionError) {
      const statuses = {
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
      } as const;

      return json(
        { message: error.message },
        statuses[error.code],
      );
    }

    console.error("Society application resubmission failed.");

    return json(
      {
        message:
          "Unable to resubmit your application. Please try again.",
      },
      500,
    );
  }
}