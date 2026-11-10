/**
 * Derived Issue progress read model (ADR-0008 §6, Issue #148).
 *
 * PURE: no I/O, nothing stored, nothing mutated. Inputs are plain Issue
 * objects (`doc.toObject()`) or any object with the same fields; every result
 * is a new plain value. Nothing here reads a person's identity: the codes and
 * the timestamp are the SAME for every viewer, which is what keeps a pending
 * grant indistinguishable from no grant for non-participants (ADR-0007 §7).
 * Naming who is being waited on stays in the viewer-specific workflow view.
 *
 * There is deliberately no stall threshold, SLA or deadline: age is exposed
 * (`waitingSince`) and given no meaning (ADR-0008 §6, D-6).
 */

/** Stable codes; presentation copy belongs to the UI. */
export const NEXT_ACTIONS = Object.freeze([
  "awaiting_acknowledgement",
  "awaiting_responsible_party",
  "awaiting_start",
  "work_in_progress",
  "awaiting_verification",
  "verified",
]);

/** Needs-attention queue identifiers (ADR-0008 §6). */
export const ATTENTION_QUEUES = Object.freeze(["unacknowledged", "unassigned", "awaiting_verification"]);

/**
 * "none" (no grant), "pending" (offered, not accepted) or "accepted".
 * Only an ACCEPTED grant makes someone responsible (ADR-0007 §2).
 */
export function responsibilityOf(issue) {
  const grant = issue?.remediation;
  if (!grant || !grant.grantId) return "none";
  return grant.acceptedAt ? "accepted" : "pending";
}

/**
 * What the Issue is waiting on, as a stable code, identical for every viewer.
 * A pending grant counts as "no responsible party". Returns `null` only for a
 * status outside the lifecycle (never for a valid Issue).
 */
export function deriveNextAction(issue) {
  const accepted = responsibilityOf(issue) === "accepted";
  switch (issue?.status) {
    case "open":
      return "awaiting_acknowledgement";
    case "acknowledged":
      return accepted ? "awaiting_start" : "awaiting_responsible_party";
    case "in_progress":
      return accepted ? "work_in_progress" : "awaiting_responsible_party";
    case "resolved":
      return "awaiting_verification";
    case "verified":
      return "verified";
    default:
      return null;
  }
}

/**
 * When the Issue entered its current status: the timestamp of the LAST
 * `statusHistory` entry (for `open` that is the report itself), else
 * `createdAt`, else `null` (unknown). Never the current time. The same rule is
 * implemented in the attention-queue aggregation; the tests assert parity on
 * malformed shapes (empty/non-array history, a last entry without a
 * timestamp, no `createdAt`).
 */
export function deriveWaitingSince(issue) {
  const history = Array.isArray(issue?.statusHistory) ? issue.statusHistory : [];
  const latest = history.length > 0 ? history[history.length - 1] : null;
  return latest?.timestamp ?? issue?.createdAt ?? null;
}

/**
 * Whether a dispute of the current resolution is open.
 *
 * CURRENT IMPLEMENTATION LIMITATION: dispute storage does not exist yet
 * (ADR-0008 slices 6-7 add `disputeHistory`), so this is `false` for every
 * Issue today. That is NOT a claim that disputes cannot exist, and a consumer
 * must not read `false` as "no dispute is possible". It is a function, not a
 * literal in the DTO, so the dispute slice replaces one derivation and the
 * contract field is already in place.
 */
export function deriveResolutionDisputed() {
  return false;
}

/** The three contract fields delivered with the Issue detail read. */
export function deriveProgress(issue) {
  return {
    nextAction: deriveNextAction(issue),
    waitingSince: deriveWaitingSince(issue),
    resolutionDisputed: deriveResolutionDisputed(issue),
  };
}
