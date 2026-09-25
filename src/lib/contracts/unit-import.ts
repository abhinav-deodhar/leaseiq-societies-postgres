import { z } from "zod";
import { createUnitSchema } from "./units";

export const unitImportSchema = z.strictObject({
  mode: z.enum(["preview", "import"]),
  rows: z.array(createUnitSchema).min(1).max(500),
});

export type UnitImportRequest = z.output<typeof unitImportSchema>;

export type UnitImportIssue = {
  row: number;
  message: string;
};

export type UnitImportResult = {
  valid: boolean;
  imported: number;
  rowCount: number;
  issues: UnitImportIssue[];
};
