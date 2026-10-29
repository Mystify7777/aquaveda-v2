import { z } from "zod";

/**
 * GET /api/v1/geocode/search query. `q` is user-typed place text: normalized
 * (NFC, controls removed, whitespace collapsed) then bounded. A place search
 * is submit-driven, never per-keystroke, so a 3-character minimum is a
 * sanity floor, not an autocomplete threshold.
 */
export const GEOCODE_QUERY_MIN = 3;
export const GEOCODE_QUERY_MAX = 200;

export const geocodeSearchQuerySchema = z.object({
  q: z
    .string({ required_error: "q is required", invalid_type_error: "q must be a string" })
    .max(1000, `q must be at most ${GEOCODE_QUERY_MAX} characters`)
    .transform((raw) =>
      raw
        .normalize("NFC")
        .replace(/\s+/g, " ")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
        .trim(),
    )
    .pipe(
      z
        .string()
        .min(GEOCODE_QUERY_MIN, `q must be at least ${GEOCODE_QUERY_MIN} characters`)
        .max(GEOCODE_QUERY_MAX, `q must be at most ${GEOCODE_QUERY_MAX} characters`),
    ),
});
