/**
 * Client-safe failure reasons (Issue #142, ADR-0007 §10).
 *
 * `sendError` forwards `err.details.reason` ONLY when it is a member of this
 * fixed set. Everything else in `details` (expertCount, threshold, status
 * snapshots, ...) is never forwarded. Adding a value here is an API contract
 * change and must be recorded in the decision register.
 */
export const CLIENT_SAFE_REASONS = Object.freeze(
  new Set([
    "GRANT_EXISTS",
    "GRANT_ALREADY_ACCEPTED",
    "GRANT_NOT_ACCEPTED",
    "NO_GRANT",
    "SELF_GRANT_NOT_PERMITTED",
  ]),
);
