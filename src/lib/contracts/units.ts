import { z } from "zod";

const labelSchema = z
  .string()
  .trim()
  .max(50, "Use no more than 50 characters.")
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Control characters are not allowed.",
  );

export const societyIdSchema = z.uuid("Choose a valid society.");

export const createUnitSchema = z.strictObject({
  wing: labelSchema.default(""),

  floorLabel: labelSchema
    .nullable()
    .optional()
    .transform((value) => value || null),

  flatNumber: labelSchema.min(1, "Enter a flat number."),

  unitTypeId: z
    .uuid("Choose a valid unit type.")
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

// Occupancy and owner approval are deliberately not accepted in the
// create request. New units start with unknown occupancy and no owner.
export type CreateUnitInput = z.input<typeof createUnitSchema>;
export type CreateUnitData = z.output<typeof createUnitSchema>;

export const unitListQuerySchema = z.strictObject({
  page: z
    .string()
    .regex(/^[1-9][0-9]{0,5}$/, "Choose a valid page.")
    .transform(Number)
    .default(1),

  search: z
    .string()
    .trim()
    .max(80, "Search must contain no more than 80 characters.")
    .refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      "Control characters are not allowed.",
    )
    .default(""),
});

export type UnitListQuery = z.output<typeof unitListQuerySchema>;

export type UnitTypeSummary = {
  id: string;
  name: string;
  category:
    | "studio"
    | "one_bhk"
    | "two_bhk"
    | "three_bhk"
    | "four_plus_bhk"
    | "custom";
};

export type UnitSummary = {
  id: string;
  societyId: string;
  wing: string;
  floorLabel: string | null;
  flatNumber: string;
  unitTypeId: string | null;
  unitTypeName: string | null;
  occupancyStatus: "unknown" | "vacant" | "owner_occupied" | "rented";
  revision: number;
  createdAt: string;
};

export type UnitListResponse = {
  units: UnitSummary[];
  page: number;
  pageSize: number;
  total: number;
};
