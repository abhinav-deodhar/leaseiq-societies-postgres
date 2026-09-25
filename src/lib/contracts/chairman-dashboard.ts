export type DashboardCategory = {
  category: string;
  label: string;
  approved: number;
  registered: number;
  remaining: number;
  excess: number;
};

export type ChairmanDashboard = {
  societyId: string;
  societyName: string;
  serviceStatus: "inactive" | "active";
  approvedUnits: number;
  registeredUnits: number;
  remainingUnits: number;
  excessUnits: number;
  unassignedUnits: number;
  categories: DashboardCategory[];
  generatedAt: string;
};
