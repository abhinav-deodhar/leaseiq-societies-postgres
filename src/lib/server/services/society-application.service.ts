import "server-only";
import type { SocietyApplicationData } from "@/lib/validation/society";
import { getDatabase } from "@/lib/server/db";
import { ApplicationError } from "./application-error";
import {
  applicantHasApplication,
  insertPendingApplication,
  insertPendingChairmanMembership,
  insertSociety,
  insertSubmissionEvent,
  lockEligibleApplicant,
} from "@/lib/server/repositories/society-application.repository";

export type SubmittedApplication = {
  id: string;
  societyId: string;
  status: "pending_review";
  submittedAt: string;
};

export async function submitSocietyApplication(
  authenticatedUserId: string,
  data: SocietyApplicationData,
): Promise<SubmittedApplication> {
  const client = await getDatabase().connect();

  try {
    await client.query("BEGIN");

    const applicant = await lockEligibleApplicant(
      client,
      authenticatedUserId,
    );

    if (!applicant) {
      throw new ApplicationError(
        "FORBIDDEN",
        "This account cannot submit an application.",
      );
    }

    if (await applicantHasApplication(client, authenticatedUserId)) {
      throw new ApplicationError(
        "APPLICATION_EXISTS",
        "You already have a society application. Open it to check its status.",
      );
    }

    const societyId = await insertSociety(
      client,
      authenticatedUserId,
      data,
    );

    await insertPendingChairmanMembership(
      client,
      societyId,
      authenticatedUserId,
    );

    const application = await insertPendingApplication(
      client,
      societyId,
      authenticatedUserId,
    );

    await insertSubmissionEvent(
      client,
      application.id,
      authenticatedUserId,
      data,
      applicant,
    );

    await client.query("COMMIT");

    return {
      id: application.id,
      societyId,
      status: "pending_review",
      submittedAt: application.submittedAt.toISOString(),
    };
    } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}