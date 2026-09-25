import "server-only";
import { findChairmanApplication } from "@/lib/server/repositories/chairman-application.repository";

export async function getChairmanApplication(
  authenticatedUserId: string,
) {
  const application = await findChairmanApplication(authenticatedUserId);

  if (!application) {
    return null;
  }

  return {
    ...application,
    submittedAt: application.submittedAt?.toISOString() ?? null,
  };
}