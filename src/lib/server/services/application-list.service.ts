import "server-only";
import type {
  ApplicationListQuery,
  ApplicationListResponse,
} from "@/lib/contracts/application-list";
import {
  APPLICATION_PAGE_SIZE,
  findApplicationsForAdmin,
} from "@/lib/server/repositories/application-list.repository";

export async function listApplicationsForAdmin(
  authenticatedAdminId: string,
  query: ApplicationListQuery,
): Promise<ApplicationListResponse> {
  const rows = await findApplicationsForAdmin(authenticatedAdminId, query);

  return {
    applications: rows.slice(0, APPLICATION_PAGE_SIZE).map((row) => ({
      ...row,
      submittedAt: row.submittedAt.toISOString(),
    })),
    hasMore: rows.length > APPLICATION_PAGE_SIZE,
  };
}