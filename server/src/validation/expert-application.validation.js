import { z } from "zod";

import { objectIdString } from "./shared/objectId.js";
import { paginationQuerySchema } from "./shared/pagination.js";

/**
 * Expert-application request shapes (#91).
 *
 * Deliberately tiny: apply/approve carry no body, and NO schema accepts
 * role, status, applicant, or reviewer — those are never client input.
 * `.strict()` makes a smuggled `role: "EXPERT"` a 400 rather than a
 * silently-ignored field.
 */
export const applicantIdParamSchema = z.object({ userId: objectIdString });

export const rejectExpertApplicationSchema = z
  .object({
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const applyExpertApplicationSchema = z.object({}).strict();

export const pendingExpertApplicationsQuerySchema = paginationQuerySchema;
