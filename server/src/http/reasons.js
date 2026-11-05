/**
 * Client-safe failure reasons (Issue #142, ADR-0007 section 10).
 *
 * `sendError` forwards `err.details.reason` ONLY when `isClientSafeReason`
 * accepts it. Everything else in `details` (expertCount, threshold, status
 * snapshots, ...) is never forwarded. The backing Set is module-private, so
 * nothing outside this file can add to the allowlist at runtime; the exported
 * array is frozen and exists for documentation and tests. Adding a value is an
 * API contract change and must be recorded in the decision register.
 */
const REASONS = ["GRANT_EXISTS", "GRANT_ALREADY_ACCEPTED", "GRANT_NOT_ACCEPTED", "NO_GRANT", "SELF_GRANT_NOT_PERMITTED"];
const ALLOWED = new Set(REASONS);

export const CLIENT_SAFE_REASONS = Object.freeze([...REASONS]);

export function isClientSafeReason(value) {
  return typeof value === "string" && ALLOWED.has(value);
}
