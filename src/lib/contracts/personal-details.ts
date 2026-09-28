import { z } from "zod";
import { dateOfBirthSchema } from "@/lib/validation/auth";

const printable = (value: string) =>
  Array.from(value).every(char =>
    char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);

export const personalDetailsSchema = z.strictObject({
  fullName: z.string().trim()
    .min(2, "Enter your full name.")
    .max(120, "Use no more than 120 characters.")
    .refine(printable, "Remove unsupported characters from your name."),
  preferredName: z.string().trim()
    .max(80, "Preferred name must be 80 characters or fewer.")
    .refine(printable, "Remove unsupported characters from your preferred name.")
    .transform(value => value || null),
  dateOfBirth: dateOfBirthSchema.nullable(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  currentPassword: z.string().max(128).optional(),
});

export type PersonalDetails = {
  fullName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  revision: number;
};

export function changedPersonalFields(
  current: PersonalDetails,
  next: Pick<PersonalDetails, "fullName" | "preferredName" | "dateOfBirth">,
) {
  return (["fullName", "preferredName", "dateOfBirth"] as const)
    .filter(key => current[key] !== next[key]);
}
