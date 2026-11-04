/**
 * Remediation grant domain rules (ADR-0007) — pure module, no imports.
 *
 * A grant is the ONLY source of remediation authority. It is embedded on the
 * Issue as `Issue.remediation` and never inferred from role, ownership,
 * Project membership, or ADMIN. See docs/adr/ADR-0007-remediation-authorization.md.
 */

/** Statuses in which any grant operation is permitted (acknowledgement stays mandatory). */
export const GRANT_OPERATION_STATUSES = Object.freeze(["acknowledged", "in_progress"]);

export const REMEDIATION_EVENT_TYPES = Object.freeze([
  "granted",
  "accepted",
  "declined",
  "released",
  "withdrawn",
  "revoked",
]);

/**
 * @param {{ acceptedAt?: Date | null } | null | undefined} remediation
 * @returns {"unassigned" | "pending" | "accepted"}
 */
export function deriveResponsibilityState(remediation) {
  if (!remediation) return "unassigned";
  return remediation.acceptedAt ? "accepted" : "pending";
}

/** True iff `actorId` holds an ACCEPTED grant. Role is deliberately not a parameter. */
export function isAcceptedGrantee(remediation, actorId) {
  return (
    deriveResponsibilityState(remediation) === "accepted" &&
    String(remediation.actor) === String(actorId)
  );
}

/**
 * Adaptive self-grant policy (ADR-0007 §2): an EXPERT may grant themselves
 * only while the EXPERT pool is small. `threshold = 0` disables it. This is a
 * policy input, not an authority check, and is evaluated outside the atomic
 * filter (documented limitation).
 *
 * @param {{ expertCount: number, threshold: number }} input
 */
export function selfGrantPermitted({ expertCount, threshold }) {
  return Number.isInteger(expertCount) && Number.isInteger(threshold) && expertCount < threshold;
}
