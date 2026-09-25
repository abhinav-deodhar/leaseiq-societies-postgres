import "server-only";
import { getDatabase } from "@/lib/server/db";
import type { ApplicationResubmissionData } from "@/lib/validation/application-resubmission";
import { lockEligibleApplicant } from "@/lib/server/repositories/society-application.repository";
import {
  insertResubmissionEvent,
  lockOwnedApplication,
  markApplicationResubmitted,
  updateApplicationSociety,
} from "@/lib/server/repositories/application-resubmission.repository";

export class ApplicationResubmissionError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ApplicationResubmissionError";
  }
}

export async function resubmitSocietyApplication(
  authenticatedUserId: string,
  data: ApplicationResubmissionData,
) {
  const client = await getDatabase().connect();

  try {
    await client.query("BEGIN");

    const applicant = await lockEligibleApplicant(
      client,
      authenticatedUserId,
    );

    if (!applicant) {
      throw new ApplicationResubmissionError(
        "FORBIDDEN",
        "This account cannot resubmit an application.",
      );
    }

    const application = await lockOwnedApplication(
      client,
      data.applicationId,
      authenticatedUserId,
    );

    if (!application) {
      throw new ApplicationResubmissionError(
        "NOT_FOUND",
        "Application not found.",
      );
    }

    if (application.status !== "changes_requested") {
      throw new ApplicationResubmissionError(
        "CONFLICT",
        "You can edit only applications with changes requested.",
      );
    }

    if (application.revision !== data.expectedRevision) {
      throw new ApplicationResubmissionError(
        "CONFLICT",
        "This application has changed. Refresh the page before editing.",
      );
    }

    await updateApplicationSociety(
      client,
      application.societyId,
      data.society,
    );

    const updated = await markApplicationResubmitted(
      client,
      application.id,
      application.revision,
    );

    await insertResubmissionEvent(client, {
      applicationId: application.id,
      userId: authenticatedUserId,
      revision: updated.revision,
      previousReviewNote: application.reviewNote,
      society: data.society,
      applicant,
    });

    await client.query("COMMIT");

    return {
      id: application.id,
      societyId: application.societyId,
      status: "pending_review" as const,
      revision: updated.revision,
      submittedAt: updated.submittedAt.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}