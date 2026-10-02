export type ResidentHome = {
  unitId: string;
  societyId: string;
  societyName: string;
  city: string;
  wing: string;
  floor: string | null;
  flatNumber: string;
  relationship: "owner" | "tenant";
  sourceRequestId: string;
  accessState: "active" | "upcoming";
  moveInDate: string | null;
  tenancyEndDate: string | null;
};

export type ResidentDashboardApplication = {
  id: string;
  societyName: string;
  wing: string;
  flatNumber: string;
  relationship: "owner" | "tenant";
  status: string;
  reviewNote: string | null;
};

export type ResidentDashboardData = {
  preferredName?: string | null;
  homes: ResidentHome[];
  counts: Record<string, number>;
  applications: ResidentDashboardApplication[];
};

export function homeLabel(home: ResidentHome): string {
  return `${home.wing ? home.wing + " / " : ""}${home.flatNumber}`;
}
