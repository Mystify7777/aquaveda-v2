import { z } from "zod";

/**
 * Shared pagination query-parameter validation.
 *
 * Placed in `validation/shared/` for the same reason `objectId.js` lives
 * here: it's a genuinely reusable primitive (any future list endpoint
 * needs page/limit), not a generic abstraction invented in search of a
 * use.
 *
 * Query parameters arrive as strings from Express, so `z.coerce.number()`
 * is used to parse them into numbers before applying constraints. This
 * means `?page=2` (string "2") is valid, while `?page=abc` correctly
 * fails validation.
 *
 * Defaults: page = 1, limit = 10. Maximum limit = 50.
 */

export const PAGINATION_DEFAULTS = Object.freeze({
  PAGE: 1,
  LIMIT: 10,
  MAX_LIMIT: 50,
});

export const paginationSchema = z.object({
  page: z.coerce
    .number({ invalid_type_error: "page must be a number" })
    .int("page must be an integer")
    .min(1, "page must be at least 1")
    .default(PAGINATION_DEFAULTS.PAGE),

  limit: z.coerce
    .number({ invalid_type_error: "limit must be a number" })
    .int("limit must be an integer")
    .min(1, "limit must be at least 1")
    .max(PAGINATION_DEFAULTS.MAX_LIMIT, `limit must not exceed ${PAGINATION_DEFAULTS.MAX_LIMIT}`)
    .default(PAGINATION_DEFAULTS.LIMIT),
});
