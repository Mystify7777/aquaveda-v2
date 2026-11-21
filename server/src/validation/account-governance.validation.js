import { z } from "zod";

import { objectIdString } from "./shared/objectId.js";
import {
  DIRECTORY_ROLES,
  DIRECTORY_STATES,
  SEARCH_MIN_LENGTH,
  SEARCH_MAX_LENGTH,
} from "../domain/account-directory.js";
import { paginationQuerySchema } from "./shared/pagination.js";

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

// Explicit `kind` (never inferred from a missing expiry): an indefinite
// suspension cannot result from merely omitting expiresAt. `reason` is the
// private enforcement reason and is required for a suspension.
export const suspendAccountSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("TEMPORARY"),
      expiresAt: z.string().datetime({ message: "expiresAt must be an ISO 8601 date-time" }),
      reason: z.string(),
      safeReason: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("INDEFINITE"),
      reason: z.string(),
      safeReason: z.string().optional(),
    })
    .strict(),
]);

export const liftSuspensionSchema = z
  .object({
    reason: z.string().optional(),
  })
  .strict();

export const liftMuteSchema = z
  .object({
    reason: z.string().optional(),
  })
  .strict();

// --- Admin directory read API (#181) ----------------------------------------
// Query bodies are .strict(): an unknown/misspelled parameter is a 400, never a
// silently unfiltered directory.

export const accountDirectoryQuerySchema = paginationQuerySchema
  .extend({
    role: z.enum(DIRECTORY_ROLES).optional(),
    accountState: z.enum(DIRECTORY_STATES).optional(),
    q: z
      .string()
      .trim()
      .min(SEARCH_MIN_LENGTH, `q must be at least ${SEARCH_MIN_LENGTH} characters`)
      .max(SEARCH_MAX_LENGTH)
      .optional(),
  })
  .strict();

export const accountHistoryQuerySchema = paginationQuerySchema.strict();
