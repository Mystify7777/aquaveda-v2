/**
 * Pure facts about an Issue's lifecycle history, independent of any
 * authorization or presentation concern. Used by the transition authorization
 * (`services/issue.service.js`) and the workflow capability evaluator
 * (`domain/workflow-actions.js`), so neither depends on the other.
 */

const idOf = (v) => (v == null ? null : String(v._id ?? v));

/**
 * The actor of the `in_progress -> resolved` entry that produced the current
 * `resolved` status, derived from the append-only `statusHistory` (no flat
 * `resolvedBy` field exists: ADR-0005/0007). `null` when the latest entry is not
 * a resolution (the services treat that as an invalid state).
 */
export function resolverOf(issue) {
  const history = Array.isArray(issue?.statusHistory) ? issue.statusHistory : [];
  const last = history.length > 0 ? history[history.length - 1] : null;
  return last && last.toStatus === "resolved" ? idOf(last.actor) : null;
}
