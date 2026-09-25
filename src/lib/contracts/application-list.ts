import { z } from "zod";

export const APPLICATION_STATUSES = [
  "pending_review",
  "changes_requested",
  "approved",
  "rejected",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending_review: "Pending review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
};

export const applicationListQuerySchema = z.strictObject({
  status: z.enum(["all", ...APPLICATION_STATUSES]),
  page: z.coerce.number().int().min(1).max(10000),
});

export type ApplicationListQuery = z.output<
  typeof applicationListQuerySchema
>;

export type ApplicationSummary = {
  id: string;
  status: ApplicationStatus;
  submittedAt: string;
  societyName: string;
  city: string;
  state: string;
  totalUnits: number;
  chairmanName: string;
  chairmanEmail: string;
  chairmanPhone: string;
};

export type ApplicationListResponse = {
  applications: ApplicationSummary[];
  hasMore: boolean;
};