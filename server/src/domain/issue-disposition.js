import { hasRole } from "./actor.js";

/** Terminal triage outcomes for an Issue. The lifecycle status remains unchanged. */
export const ISSUE_DISPOSITIONS = Object.freeze([
  "invalid",
  "duplicate",
  "withdrawn",
]);

export function isDisposed(issue) {
  return Boolean(issue?.disposition?.type);
}

export function canDispose(issue) {
  return issue?.status === "open" && !isDisposed(issue);
}

export function canAssignDisposition(issue, actor, type) {
  if (!canDispose(issue)) return false;
  if (type === "withdrawn") {
    return String(issue.reportedBy) === String(actor?.id);
  }
  return (type === "invalid" || type === "duplicate") && hasRole(actor, "EXPERT");
}
