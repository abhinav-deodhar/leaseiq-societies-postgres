import { z } from "zod";

export const awayOccupancySchema = z.enum(["VARR", "VNRR", "UM", "CR", "FO"]);
export type AwayOccupancy = z.infer<typeof awayOccupancySchema>;

export const occupancyLabels = {
  OO: { label: "Owner occupied", tone: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  VARR: { label: "Vacant and ready to rent", tone: "border-blue-200 bg-blue-50 text-blue-900" },
  VNRR: { label: "Vacant and not ready to rent", tone: "border-amber-200 bg-amber-50 text-amber-900" },
  UM: { label: "Under maintenance", tone: "border-orange-200 bg-orange-50 text-orange-900" },
  CR: { label: "Currently rented", tone: "border-purple-200 bg-purple-50 text-purple-900" },
  FO: { label: "Family occupied", tone: "border-teal-200 bg-teal-50 text-teal-900" },
  V: { label: "Vacant — rental readiness not provided", tone: "border-yellow-200 bg-yellow-50 text-yellow-900" },
  UNK: { label: "Occupancy not provided", tone: "border-slate-200 bg-slate-100 text-slate-700" },
} as const;

export function occupancyDisplay(badge: string | undefined, status: string) {
  const fallback = status === "owner_occupied" ? "OO" : status === "rented" ? "CR" : status === "vacant" ? "V" : "UNK";
  const code = badge && Object.prototype.hasOwnProperty.call(occupancyLabels, badge)
    ? badge as keyof typeof occupancyLabels : fallback;
  return { code, ...occupancyLabels[code] };
}

export const ownerOccupancyUpdateSchema = z.strictObject({
  societyId: z.uuid(), unitId: z.uuid(),
  expectedRevision: z.number().int().min(1).max(2147483646),
  occupancy: awayOccupancySchema,
});
