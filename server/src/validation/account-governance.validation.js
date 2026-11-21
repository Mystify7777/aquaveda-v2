import { z } from "zod";

import { objectIdString } from "./shared/objectId.js";

/**
 * Account-governance request shapes (#174). Bodies are `.strict()`: no schema
 * accepts a state, actor, restriction kind, or timestamp other than the
 * explicit expiry, so nothing can smuggle one in. Content rules (bounds,
 * future-dated expiry) live in the service, which validates again so direct
 * callers cannot bypass them.
 */
export const accountIdParamSchema = z.object({ userId: objectIdString });

export const muteAccountSchema = z
  .object({
    expiresAt: z.string().datetime({ message: "expiresAt must be an ISO 8601 date-time" }),
    reason: z.string().optional(),
    safeReason: z.string().optional(),
  })
  .strict();

export const liftMuteSchema = z
  .object({
    reason: z.string().optional(),
  })
  .strict();
