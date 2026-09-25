import { z } from "zod";

export const applicationReviewSchema = z
  .strictObject({
    decision: z.enum(["approved", "changes_requested", "rejected"]),
    expectedStatus: z.enum(["pending_review", "changes_requested"]),
    expectedRevision: z.number().int().min(1),
    note: z.string().trim().max(2000).default(""),
  })
  .superRefine((data, context) => {
    if (data.decision !== "approved" && data.note.length < 5) {
      context.addIssue({
        code: "custom",
        path: ["note"],
        message: "Provide a clear reason using at least five characters.",
      });
    }

    if (
      data.expectedStatus === "changes_requested" &&
      data.decision !== "rejected"
    ) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message:
          "While awaiting chairman corrections, only rejection is allowed.",
      });
    }
  });

export type ApplicationReviewData = z.output<
  typeof applicationReviewSchema
>;