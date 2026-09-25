import { z } from "zod";

export const STANDARD_UNIT_KEYS = [
  "studioUnits",
  "oneBhkUnits",
  "twoBhkUnits",
  "threeBhkUnits",
  "fourPlusBhkUnits",
] as const;

export type StandardUnitKey = (typeof STANDARD_UNIT_KEYS)[number];

function count() {
  return z
    .number({ error: "Enter a number." })
    .int("Enter a whole number.")
    .min(0, "Count cannot be negative.")
    .max(100000, "Count cannot exceed 100,000.");
}

const customUnitSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, "Describe the custom residential unit type.")
    .max(200, "Use no more than 200 characters."),
  count: count().min(1, "Enter at least one custom unit."),
});

const unitMixSchema = z
  .strictObject({
    studioUnits: count(),
    oneBhkUnits: count(),
    twoBhkUnits: count(),
    threeBhkUnits: count(),
    fourPlusBhkUnits: count(),
    customUnits: z
      .array(customUnitSchema)
      .max(20, "Use no more than 20 custom unit types."),
  })
  .superRefine((mix, context) => {
    const total =
      STANDARD_UNIT_KEYS.reduce((sum, key) => sum + mix[key], 0) +
      mix.customUnits.reduce((sum, item) => sum + item.count, 0);

    if (total < 1 || total > 100000) {
      context.addIssue({
        code: "custom",
        path: ["studioUnits"],
        message: "Enter between 1 and 100,000 residential units in total.",
      });
    }

    const names = new Set<string>();

    mix.customUnits.forEach((item, index) => {
      const name = item.name.toLowerCase();

      if (names.has(name)) {
        context.addIssue({
          code: "custom",
          path: ["customUnits", index, "name"],
          message:
            "This custom type is already listed. Combine its counts.",
        });
      }

      names.add(name);
    });
  });

const floorLabelSchema = z
  .string()
  .trim()
  .min(1, "Enter a floor label.")
  .max(20, "Floor labels cannot exceed 20 characters.")
  .refine(value => !/^\d+\s*[-–]\s*\d+$/.test(value), "List each floor separately, for example 1, 2, 3; do not enter a range.")
  .transform((value) => value.toUpperCase());

const floorGroupSchema = z.strictObject({
  floors: z
    .array(floorLabelSchema)
    .min(1, "Add at least one residential floor.")
    .max(300, "A group cannot contain more than 300 floors."),
  unitsPerFloor: unitMixSchema,
});

const wingSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1, "Enter a wing or building name.")
      .max(60, "Use no more than 60 characters."),
    floorGroups: z
      .array(floorGroupSchema)
      .min(1, "Add at least one floor group.")
      .max(100, "Use no more than 100 floor groups per wing."),
  })
  .superRefine((wing, context) => {
    const floors = new Set<string>();

    wing.floorGroups.forEach((group, groupIndex) => {
      group.floors.forEach((floor, floorIndex) => {
        // Treat numeric labels such as 01 and 1 as the same floor.
        const key = /^\d+$/.test(floor)
          ? floor.replace(/^0+(?=\d)/, "")
          : floor;

        if (floors.has(key)) {
          context.addIssue({
            code: "custom",
            path: ["floorGroups", groupIndex, "floors", floorIndex],
            message: `Floor ${floor} is already included in this wing.`,
          });
        }

        floors.add(key);
      });
    });
  });

const calculatedLayoutSchema = z
  .strictObject({
    mode: z.literal("layout"),
    buildingType: z.enum(["wings", "standalone"]),
    wings: z
      .array(wingSchema)
      .min(1, "Add at least one wing or building.")
      .max(1000, "A society cannot exceed 1,000 wings."),
  })
  .superRefine((layout, context) => {
    if (
      layout.buildingType === "standalone" &&
      layout.wings.length !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["wings"],
        message: "A standalone building must have one building entry.",
      });
    }

    const names = new Set<string>();

    layout.wings.forEach((wing, index) => {
      const name = wing.name.toLowerCase();

      if (names.has(name)) {
        context.addIssue({
          code: "custom",
          path: ["wings", index, "name"],
          message: "Each wing must have a different name.",
        });
      }

      names.add(name);
    });
  });

const manualLayoutSchema = z.strictObject({
  mode: z.literal("manual"),
  wingCount: z
    .number({ error: "Enter the number of wings." })
    .int("Enter a whole number.")
    .min(0, "Use zero for a standalone building.")
    .max(1000, "Wing count cannot exceed 1,000."),
  units: unitMixSchema,
});

const residentialInputSchema = z.discriminatedUnion("mode", [
  calculatedLayoutSchema,
  manualLayoutSchema,
]);

type ValidatedResidentialInput = z.output<
  typeof residentialInputSchema
>;

export type ResidentialTotals = Record<StandardUnitKey, number> & {
  wingCount: number;
  totalUnits: number;
  otherResidentialUnits: number;
  customUnits: Array<{ name: string; count: number }>;
};

function calculateTotals(
  input: ValidatedResidentialInput,
): ResidentialTotals {
  const totals: ResidentialTotals = {
    wingCount:
      input.mode === "manual"
        ? input.wingCount
        : input.buildingType === "standalone"
          ? 0
          : input.wings.length,
    totalUnits: 0,
    studioUnits: 0,
    oneBhkUnits: 0,
    twoBhkUnits: 0,
    threeBhkUnits: 0,
    fourPlusBhkUnits: 0,
    otherResidentialUnits: 0,
    customUnits: [],
  };

  const customTotals = new Map<
    string,
    { name: string; count: number }
  >();

  function addMix(
    mix: z.output<typeof unitMixSchema>,
    numberOfFloors: number,
  ) {
    for (const key of STANDARD_UNIT_KEYS) {
      totals[key] += mix[key] * numberOfFloors;
    }

    for (const item of mix.customUnits) {
      const key = item.name.toLowerCase();
      const quantity = item.count * numberOfFloors;
      const existing = customTotals.get(key);

      if (existing) {
        existing.count += quantity;
      } else {
        customTotals.set(key, {
          name: item.name,
          count: quantity,
        });
      }
    }
  }

  if (input.mode === "manual") {
    addMix(input.units, 1);
  } else {
    for (const wing of input.wings) {
      for (const group of wing.floorGroups) {
        addMix(group.unitsPerFloor, group.floors.length);
      }
    }
  }

  totals.customUnits = [...customTotals.values()];
  totals.otherResidentialUnits = totals.customUnits.reduce(
    (sum, item) => sum + item.count,
    0,
  );

  totals.totalUnits =
    STANDARD_UNIT_KEYS.reduce((sum, key) => sum + totals[key], 0) +
    totals.otherResidentialUnits;

  return totals;
}

export const residentialLayoutSchema = residentialInputSchema
  .superRefine((input, context) => {
    const totals = calculateTotals(input);

    if (totals.totalUnits > 100000) {
      context.addIssue({
        code: "custom",
        path: [input.mode === "layout" ? "wings" : "units"],
        message: "The society cannot exceed 100,000 residential units.",
      });
    }
  })
  .transform((input) => ({
    ...input,
    totals: calculateTotals(input),
  }));

export type ResidentialLayoutInput = z.input<
  typeof residentialLayoutSchema
>;

export type ResidentialLayoutData = z.output<
  typeof residentialLayoutSchema
>;