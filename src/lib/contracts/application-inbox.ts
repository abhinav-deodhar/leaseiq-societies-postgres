import type { ResidentProfile } from "./resident-profile";

export type ApplicationStatus =
  | "draft" | "pending" | "changes_requested" | "approved" | "rejected" | "withdrawn";

export type InboxApplication = {
  id: string;
  societyId: string;
  societyName: string;
  wing: string;
  floor: string | null;
  flatNumber: string;
  relationship: "owner" | "tenant";
  ownerReviewStatus?: "not_required" | "pending" | "approved" | "rejected";
  status: ApplicationStatus;
  revision: number;
  fullName: string;
  email: string;
  phone: string;
  applicantProfile: ResidentProfile | null;
  applicantNote: string | null;
  moveInDate: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  isOwn: boolean;
  associationStatus: "active" | "ended" | "scheduled" | null;
  currentOwners: Array<{ membershipId: string; fullName: string }>;
  resubmissionCount: number;
  history: {
    action: string;
    revision: number;
    at: string;
    note: string | null;
  }[];
};

export const applicationStatusLabels: Record<ApplicationStatus, string> = {
  draft: "Draft",
  changes_requested: "Changes requested",
  pending: "Awaiting chairman review",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
