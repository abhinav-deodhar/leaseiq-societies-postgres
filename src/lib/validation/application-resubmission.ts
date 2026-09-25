import { z } from "zod";
import { societyApplicationSchema } from "./society";

export const applicationResubmissionSchema = z.strictObject({
  applicationId: z.uuid(),
  expectedRevision: z.number().int().min(1).max(2147483646),
  society: societyApplicationSchema,
});

export type ApplicationResubmissionData = z.output<
  typeof applicationResubmissionSchema
>;