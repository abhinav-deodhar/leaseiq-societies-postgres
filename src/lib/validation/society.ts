import { z } from "zod";
import { residentialLayoutSchema, type ResidentialLayoutInput } from "./residential-layout";

export const INDIAN_STATES_AND_UTS = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

function unitCount() {
  return z
    .number()
    .int("Enter a whole number.")
    .min(0, "Count cannot be negative.")
    .max(100000, "Count cannot exceed 100,000.");
}

const optionalAddress = z
  .string()
  .trim()
  .max(250, "Address line cannot exceed 250 characters.")
  .transform((value) => value || null);

const optionalDescription = z
  .string()
  .trim()
  .max(200, "Description cannot exceed 200 characters.")
  .transform((value) => value || null);

const legacySocietyApplicationSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(2, "Enter the society name.")
      .max(200, "Society name cannot exceed 200 characters."),

    addressLine1: z
      .string()
      .trim()
      .min(5, "Enter the society address.")
      .max(250, "Address line cannot exceed 250 characters."),

    addressLine2: optionalAddress,

    city: z
      .string()
      .trim()
      .min(2, "Enter the city.")
      .max(100, "City cannot exceed 100 characters."),

    state: z.enum(INDIAN_STATES_AND_UTS, {
  error: "Please select your state or union territory.",
}),

    pinCode: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/, "Enter a valid six-digit PIN code."),

    wingCount: z
      .number()
      .int("Enter a whole number.")
      .min(0, "Use zero for a building without named wings.")
      .max(1000, "Wing count cannot exceed 1,000."),

    totalUnits: z
      .number()
      .int("Enter a whole number.")
      .min(1, "A society must have at least one residential unit.")
      .max(100000, "Total units cannot exceed 100,000."),

    studioUnits: unitCount(),
    oneBhkUnits: unitCount(),
    twoBhkUnits: unitCount(),
    threeBhkUnits: unitCount(),
    fourPlusBhkUnits: unitCount(),
    otherResidentialUnits: unitCount(),

    otherResidentialDescription: optionalDescription,
  })
  .superRefine((data, context) => {
    const calculatedTotal =
      data.studioUnits +
      data.oneBhkUnits +
      data.twoBhkUnits +
      data.threeBhkUnits +
      data.fourPlusBhkUnits +
      data.otherResidentialUnits;

    if (calculatedTotal !== data.totalUnits) {
      context.addIssue({
        code: "custom",
        path: ["totalUnits"],
        message:
          `Unit-type counts add up to ${calculatedTotal}, ` +
          `but the declared total is ${data.totalUnits}.`,
      });
    }

    if (
      data.otherResidentialUnits > 0 &&
      (!data.otherResidentialDescription ||
        data.otherResidentialDescription.length < 2)
    ) {
      context.addIssue({
        code: "custom",
        path: ["otherResidentialDescription"],
        message: "Describe the other residential unit types.",
      });
    }

    if (
      data.otherResidentialDescription !== null &&
      data.otherResidentialDescription.length < 2
    ) {
      context.addIssue({
        code: "custom",
        path: ["otherResidentialDescription"],
        message: "Use at least two characters for the description.",
      });
    }
  });

// Address validation is shared by both entry modes and both web forms.
const detailShape = legacySocietyApplicationSchema.shape;
export const societyDetailsSchema = z.strictObject({
  name: detailShape.name, addressLine1: detailShape.addressLine1,
  addressLine2: detailShape.addressLine2, city: detailShape.city,
  state: detailShape.state, pinCode: detailShape.pinCode,
});

export const calculatedSocietyApplicationSchema = z.strictObject({
  ...societyDetailsSchema.shape,
  residentialLayout: residentialLayoutSchema,
}).transform(({ residentialLayout, ...details }) => {
  const { totals, ...layout } = residentialLayout;
  return {
    ...details,
    wingCount: totals.wingCount,
    totalUnits: totals.totalUnits,
    studioUnits: totals.studioUnits,
    oneBhkUnits: totals.oneBhkUnits,
    twoBhkUnits: totals.twoBhkUnits,
    threeBhkUnits: totals.threeBhkUnits,
    fourPlusBhkUnits: totals.fourPlusBhkUnits,
    otherResidentialUnits: totals.otherResidentialUnits,
    otherResidentialDescription: totals.customUnits.length
      ? "Custom residential types — see saved layout"
      : null,
    residentialLayout: layout as ResidentialLayoutInput,
  };
});

// Existing clients may still supply the original flat counts. Their sum is
// validated above. New clients send only layout/count inputs, never totals.
export const societyApplicationSchema = z.unknown().transform((input, context) => {
  const schema = typeof input === "object" && input !== null && "residentialLayout" in input
    ? calculatedSocietyApplicationSchema
    : legacySocietyApplicationSchema.transform(data => ({
        ...data, residentialLayout: null as ResidentialLayoutInput | null,
      }));
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
    return z.NEVER;
  }
  return parsed.data;
});
export type SocietyApplicationInput = z.input<typeof calculatedSocietyApplicationSchema> | z.input<typeof legacySocietyApplicationSchema>;
export type SocietyApplicationData = z.output<typeof societyApplicationSchema>;
