import { z } from "zod";

import { paginationQuerySchema } from "./shared/pagination.js";

/**
 * Issue request-shape validation.
 *
 * Zod's job here is strictly: "is this request shaped correctly?" It does
 * NOT decide domain legality — see the transition schema below for the
 * clearest example of that boundary.
 */

const ISSUE_STATUSES = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "verified",
];

/**
 * GeoJSON Point, with geographic range validation included here.
 *
 * This is deliberately the layer that owns range checking — the
 * Mongoose schema (Issue.js) only enforces the *structural* shape
 * (exactly two finite numbers) and explicitly defers range validation
 * to "the Zod/service validation layer." This is that layer.
 */
export const geoPointSchema = z.object({
  type: z.literal("Point"),
  coordinates: z
    .tuple([z.number(), z.number()])
    .refine(([lon]) => lon >= -180 && lon <= 180, {
      message: "longitude must be between -180 and 180",
    })
    .refine(([, lat]) => lat >= -90 && lat <= 90, {
      message: "latitude must be between -90 and 90",
    }),
});

export const createIssueSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  description: z.string().trim().min(1, "description is required"),
  location: geoPointSchema,
  // severity/category are deliberately unconstrained strings — no fixed
  // vocabulary was ever locked by any approved document (see
  // decision-register.md D-9). Inventing an enum here would be making a
  // product decision inside a validation schema.
  severity: z.string().trim().optional(),
  category: z.string().trim().optional(),
});

/**
 * Issue status-transition request shape.
 *
 * Zod validates only that `targetStatus` is one of the five recognized
 * status strings — it does NOT validate that the requested transition is
 * legal from the Issue's current state, and it deliberately does not
 * narrow the enum to exclude states that could never be a valid *target*
 * of a transition (e.g. "open" is only ever a starting state in
 * ADR-0003's graph, never a target). Encoding that here would mean this
 * schema needs to know the transition graph, which is exactly the
 * responsibility ADR-0003/ADR-0006 assign to the service layer's
 * `changeStatus()` operation, not to input validation.
 */
export const changeIssueStatusSchema = z.object({
  targetStatus: z.enum(ISSUE_STATUSES),
});

/**
 * Public Issue list query shape (Issue #48).
 *
 * `status` filtering is optional and, when given, must be one of the 5
 * recognized statuses — reuses the same enum as changeIssueStatusSchema
 * rather than re-deriving it, since it's the same underlying vocabulary
 * for a different purpose (filtering, not transitioning).
 */
export const listIssuesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ISSUE_STATUSES).optional(),
});
