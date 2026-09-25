import "server-only";
import { z } from "zod";
import { findApplicationForAdmin } from "@/lib/server/repositories/application-review.repository";

const applicationIdSchema = z.uuid();

export async function getApplicationForAdmin(
  authenticatedAdminId: string,
  applicationId: string,
) {
  const validation = applicationIdSchema.safeParse(applicationId);

  if (!validation.success) {
    return null;
  }

  const application = await findApplicationForAdmin(
    authenticatedAdminId,
    validation.data,
  );

  if (!application) {
    return null;
  }

  return {
    ...application,
    submittedAt: application.submittedAt?.toISOString() ?? null,
  };
}