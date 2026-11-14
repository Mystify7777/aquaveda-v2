/**
 * Discussion domain constants.
 *
 * These are the complete MVP vocabularies locked by ADR-0009.
 * Category is classification; status is server-owned visibility.
 */

export const DISCUSSION_CATEGORIES = Object.freeze([
  "QUESTION",
  "DISCUSSION",
  "IDEA",
]);

export const DISCUSSION_STATUSES = Object.freeze(["ACTIVE", "HIDDEN"]);

export const PUBLIC_DISCUSSION_STATUS = "ACTIVE";
