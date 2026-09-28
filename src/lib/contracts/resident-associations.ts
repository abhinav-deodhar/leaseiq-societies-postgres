import { z } from "zod";

const optionalNote = z
  .string()
  .trim()
  .max(1000, "Use no more than 1,000 characters.")
  .nullish()
  .transform((value) => value || null);

const optionalDate = z
  .union([z.iso.date(), z.literal("")])
  .nullish()
  .transform((value) => value || null);

export const residentRequestSchema = z
  .strictObject({
    unitId: z.uuid("Choose a valid flat."),
    relationship: z.enum(["owner", "tenant"]),
    moveInDate: optionalDate,
    tenancyEndDate: optionalDate,
    applicantNote: optionalNote,
  })
  .superRefine((value, context) => {
    if (value.relationship === "owner" && value.tenancyEndDate !== null) {
      context.addIssue({
        code: "custom",
        path: ["tenancyEndDate"],
        message: "A tenancy end date applies only to tenants.",
      });
    }

    if (value.tenancyEndDate !== null && value.moveInDate === null) {
      context.addIssue({
        code: "custom",
        path: ["moveInDate"],
        message: "Enter a move-in date when providing a tenancy end date.",
      });
    }

    if (
      value.moveInDate !== null &&
      value.tenancyEndDate !== null &&
      value.tenancyEndDate < value.moveInDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["tenancyEndDate"],
        message: "The tenancy end date cannot precede the move-in date.",
      });
    }
  });

export const residentRequestSubmissionSchema = z.strictObject({
  expectedRevision: z.number().int().positive().max(2147483647),
});

export const residentRequestReviewSchema = z
  .strictObject({
    expectedRevision: z.number().int().positive().max(2147483647),
    decision: z.enum(["approved", "rejected", "changes_requested"]),
    reviewNote: optionalNote,
  })
  .superRefine((value, context) => {
    if (value.decision !== "approved" && value.reviewNote === null) {
      context.addIssue({
        code: "custom",
        path: ["reviewNote"],
        message: "Explain the required corrections or the reason for rejection.",
      });
    }
  });

export const residentMembershipRevocationSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1, "Enter a reason for removing access.")
    .max(1000, "Use no more than 1,000 characters."),
});

export type ResidentRequestInput = z.input<typeof residentRequestSchema>;
export type ResidentRequestData = z.output<typeof residentRequestSchema>;
export type ResidentRequestReview = z.output<typeof residentRequestReviewSchema>;
