import { z } from "zod";

/**
 * A single, genuinely shared validation primitive: page/limit query
 * parameters for a list endpoint. Justified the same way objectId.js
 * was — three concrete call sites (Issue, Knowledge, Project listing)
 * need the identical shape and bounds, not a generic pagination
 * framework invented in search of a use.
 *
 * Express query params always arrive as strings, hence z.coerce.
 * limit is capped at 50 — no approved document specifies this number;
 * it's a V2-level implementation placeholder (same status as
 * Issue.category/severity's freeform-string choice), kept deliberately
 * small since nothing in the current product plan needs large pages.
 */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional().default(DEFAULT_LIMIT),
});
