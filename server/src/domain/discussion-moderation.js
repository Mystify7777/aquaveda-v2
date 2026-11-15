/**
 * Discussion moderation constants.
 *
 * Reporting and moderation are intentionally separate from the Discussion
 * lifecycle vocabulary. Report reasons classify a private allegation; they do
 * not determine visibility or authority.
 */

export const DISCUSSION_REPORT_REASONS = Object.freeze([
  "SPAM",
  "HARASSMENT",
  "MISLEADING",
  "INAPPROPRIATE",
  "OTHER",
]);

export const DISCUSSION_MODERATION_ACTIONS = Object.freeze([
  "AUTHOR_HIDDEN",
  "ADMIN_HIDDEN",
  "ADMIN_UNHIDDEN",
]);
