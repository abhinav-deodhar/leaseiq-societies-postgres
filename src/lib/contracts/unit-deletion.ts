import { z } from "zod";

export const unitDeletionTargetSchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("all") }),
  z.strictObject({
    scope: z.literal("selected"),
    ids: z.array(z.uuid()).min(1).max(500)
      .refine((ids) => new Set(ids).size === ids.length, "Select each flat only once."),
  }),
]);

export const unitDeletionRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("preview"), target: unitDeletionTargetSchema }),
  z.strictObject({
    mode: z.literal("confirm"),
    previewId: z.uuid(),
    confirmation: z.string().min(1).max(1000),
  }),
]);

export type UnitDeletionTarget = z.output<typeof unitDeletionTargetSchema>;
export type UnitDeletionRequest = z.output<typeof unitDeletionRequestSchema>;
export type UnitDeletionRow = {
  id: string;
  wing: string;
  flatNumber: string;
  revision: number;
  reasons: string[];
};
export type UnitDeletionPreview = {
  previewId: string;
  societyName: string;
  scope: "all" | "selected";
  expiresAt: string;
  rows: UnitDeletionRow[];
};
