import { z } from "zod";

export const correspondenceAddressSchema = z.strictObject({
  line1: z.string().trim().min(1, "Enter the building and street.").max(1000),
  line2: z.string().trim().max(1000),
  city: z.string().trim().min(1, "Enter the city.").max(100),
  state: z.string().trim().min(1, "Enter the state.").max(100),
  pinCode: z.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a six-digit PIN code."),
});

export type CorrespondenceAddress = z.infer<typeof correspondenceAddressSchema>;
export type PrimaryAddress = {
  unitId: string | null;
  address: CorrespondenceAddress;
};
export type PrimaryAddressState = {
  revision: number;
  primary: PrimaryAddress | null;
  options: Array<{ unitId: string; label: string; address: CorrespondenceAddress }>;
};

export const primaryAddressUpdateSchema = z.strictObject({
  expectedRevision: z.number().int().min(0).max(2147483646),
  selection: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("flat"), unitId: z.uuid() }),
    z.strictObject({
      kind: z.literal("external"),
      address: correspondenceAddressSchema,
    }),
  ]),
});
