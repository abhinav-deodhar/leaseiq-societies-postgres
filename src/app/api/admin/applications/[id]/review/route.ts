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
import { applicationReviewSchema } from "@/lib/validation/application-review";
import {
  reviewApplication,
  ReviewError,
} from "@/lib/server/services/application-decision.service";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkRequestOrigin(request);

    const session = await getSessionFromToken(
      readSessionToken(request, "admin"),
      "admin",
    );

    if (!session) {
      return json({ message: "Sign in to your admin account." }, 401);
    }

    const { id } = await params;

    if (!z.uuid().safeParse(id).success) {
      return json({ message: "Invalid application ID." }, 400);
    }

    const validation = applicationReviewSchema.safeParse(
      await readJsonBody(request),
    );

    if (!validation.success) {
      return json(
        {
          message: "Please check your review decision.",
          errors: validation.error.issues.map((issue) => ({
            field: issue.path.join(".") || "form",
            message: issue.message,
          })),
        },
        400,
      );
    }

    const application = await reviewApplication(
      session.userId,
      id,
      validation.data,
    );

    return json(
      { message: "Review decision saved.", application },
      200,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ message: error.message }, error.status);
    }

    if (error instanceof ReviewError) {
      const statuses = {
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
      } as const;

      return json({ message: error.message }, statuses[error.code]);
    }

    console.error("Application review failed.");

    return json(
      { message: "Unable to save the decision. Please try again." },
      500,
    );
  }
}