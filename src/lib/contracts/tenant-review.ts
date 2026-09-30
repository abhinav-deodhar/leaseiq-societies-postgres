import { z } from "zod";
import { residentRequestReviewSchema } from "./resident-associations";

export const tenantReviewSchema = z.strictObject({
  societyId: z.uuid(), requestId: z.uuid(),
  review: residentRequestReviewSchema,
});
export type TenantReviewItem = {
  id: string; societyId: string; societyName: string;
  wing: string; flatNumber: string; fullName: string;
  revision: number; moveInDate: string; tenancyEndDate: string | null;
  ownerReviewStatus: string;
  documents: Array<{ id: string; name: string; kind: string }>;
};
