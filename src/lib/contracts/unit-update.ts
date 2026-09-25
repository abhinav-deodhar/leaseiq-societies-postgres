import { z } from "zod";
import { createUnitSchema } from "./units";

export const updateUnitSchema = createUnitSchema.extend({
  expectedRevision: z
    .number()
    .int()
    .min(1)
    .max(2147483646),
});

export type UpdateUnitData = z.output<typeof updateUnitSchema>;
