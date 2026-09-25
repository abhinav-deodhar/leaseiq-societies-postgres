import "server-only";
import { getDatabase } from "@/lib/server/db";
import type { ApplicationReviewData } from "@/lib/validation/application-review";
import {
  lockApplicationForDecision,
  lockReviewingAdmin,
  saveApplicationDecision,
} from "@/lib/server/repositories/application-decision.repository";

export class ReviewError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

export async function reviewApplication(
  authenticatedAdminId: string,
  applicationId: string,
  data: ApplicationReviewData,
) {
  const client = await getDatabase().connect();

  try {
    await client.query("BEGIN");

    if (!(await lockReviewingAdmin(client, authenticatedAdminId))) {
      throw new ReviewError("FORBIDDEN", "Admin access is required.");
    }

    const application = await lockApplicationForDecision(
      client,
      applicationId,
    );

    if (!application) {
      throw new ReviewError("NOT_FOUND", "Application not found.");
    }

       if (
      application.status !== data.expectedStatus ||
      (
        application.status !== "pending_review" &&
        !(
          application.status === "changes_requested" &&
          data.decision === "rejected"
        )
      )
    ) {
      throw new ReviewError(
        "CONFLICT",
        "The application status has changed or this decision is not allowed. Refresh its details.",
      );
    }

    if (application.revision !== data.expectedRevision) {
      throw new ReviewError(
        "CONFLICT",
        "The application has changed. Review the latest revision first.",
      );
    }

    if (!application.snapshot) {
      throw new ReviewError(
        "CONFLICT",
        "The submission snapshot is missing. The application cannot be reviewed.",
      );
    }

    const reviewedAt = await saveApplicationDecision(
      client,
      application.id,
      authenticatedAdminId,
      application.revision,
      data,
      application.snapshot,
    );

    await client.query("COMMIT");

    return {
      id: application.id,
      status: data.decision,
      revision: application.revision,
      note: data.note || null,
      reviewedAt: reviewedAt.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}