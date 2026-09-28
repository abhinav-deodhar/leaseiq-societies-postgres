import { z } from "zod";
import { awayOccupancySchema } from "./occupancy";

const firstName = z.string().trim()
  .min(1, "Enter a first name.").max(80);
const lastName = z.string().trim().max(80).default("");

const optionalEmail = z.string().trim().toLowerCase()
  .pipe(z.union([z.email().max(254), z.literal("")]))
  .default("");

const optionalPhone = z.string().trim()
  .transform((value) => /^[6-9][0-9]{9}$/.test(value)
    ? `+91${value}` : value)
  .pipe(z.union([
    z.string().regex(/^\+91[6-9][0-9]{9}$/,
      "Enter a valid Indian mobile number."),
    z.literal(""),
  ]))
  .default("");

export const residentFamilyMemberSchema = z.strictObject({
  firstName,
  lastName,
  relationshipToOwner: z.string().trim()
    .min(1, "Enter the relationship to the owner.").max(60),
  email: optionalEmail,
  phone: optionalPhone,
});

export const residentProfileSchema = z.strictObject({
  firstName,
  lastName,
  residesInFlat: z.boolean(),
  occupancyWhenAway: awayOccupancySchema.optional(),
  correspondenceSameAsFlat: z.boolean(),
  correspondenceAccountRevision: z.number().int().min(1).optional(),
  correspondenceAddress: z.strictObject({
    line1: z.string().trim().max(1000),
    line2: z.string().trim().max(1000),
    city: z.string().trim().max(100),
    state: z.string().trim().max(100),
    pinCode: z.string().trim().max(6),
  }),
  familyMembers: z.array(residentFamilyMemberSchema).max(20),
}).superRefine((value, context) => {
  function issue(path: (string | number)[], message: string) {
    context.addIssue({ code: "custom", path, message });
  }

  if (!value.residesInFlat && value.familyMembers.length > 0) {
    issue(["familyMembers"],
      "Add household members only when you live in this flat.");
  }

  if (!value.residesInFlat && value.correspondenceSameAsFlat) {
    issue(["correspondenceSameAsFlat"],
      "Enter your current correspondence address.");
  }

  if (!value.correspondenceSameAsFlat) {
    for (const key of ["line1", "city", "state"] as const) {
      if (!value.correspondenceAddress[key]) {
        issue(["correspondenceAddress", key],
          "Complete your correspondence address.");
      }
    }
    if (!/^[1-9][0-9]{5}$/.test(value.correspondenceAddress.pinCode)) {
      issue(["correspondenceAddress", "pinCode"],
        "Enter a valid six-digit PIN code.");
    }
  }

  const emails = new Set<string>();
  const phones = new Set<string>();
  value.familyMembers.forEach((member, index) => {
    if (member.email && emails.has(member.email)) {
      issue(["familyMembers", index, "email"],
        "Use this member's own email, or leave it blank.");
    }
    if (member.phone && phones.has(member.phone)) {
      issue(["familyMembers", index, "phone"],
        "Use this member's own mobile number, or leave it blank.");
    }
    if (member.email) emails.add(member.email);
    if (member.phone) phones.add(member.phone);
  });
});

export const residentApplicationProfileSchema = z.strictObject({
  relationship: z.enum(["owner", "tenant"]),
  profile: residentProfileSchema,
}).superRefine((value, context) => {
  if (value.relationship === "tenant" &&
      value.profile.familyMembers.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["profile", "familyMembers"],
      message: "This family-members step is for resident owners.",
    });
  }
});

export type ResidentProfile =
  z.output<typeof residentProfileSchema>;
export type ResidentFamilyMember =
  z.output<typeof residentFamilyMemberSchema>;
