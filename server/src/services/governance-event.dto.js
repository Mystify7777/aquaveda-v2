/**
 * Explicit projections of a GovernanceEvent. Raw documents are never returned
 * through an API (ADR-0010 §14: private enforcement notes stay restricted).
 *
 * Only the affected-user projection exists in this issue. It is an allowlist of
 * "safe, policy-relevant information" and is intentionally minimal: it omits
 * the actor's identity, the private `reason`, the idempotency key, internal
 * references, and the states. The Admin governance-history projection is
 * decided with the Admin directory work (#181); no audit UI or route is added
 * here.
 */
export function toAffectedUserGovernanceEvent(event) {
  return {
    id: String(event._id),
    action: event.action,
    occurredAt: event.occurredAt.toISOString(),
    safeReason: event.safeReason ?? null,
  };
}

/**
 * Admin governance-history projection (#181, ADR-0010 §13/§14). Allowlist.
 * Actor identity is shown (governance accountability); the private `reason`,
 * `references` and `idempotencyKey` are NOT. `actorsById` is a batch-hydrated
 * map (id string -> name) so callers never query per event.
 */
export function toAdminGovernanceEvent(event, actorsById = new Map()) {
  const actorId = event.actor ? String(event.actor) : null;
  return {
    id: String(event._id),
    action: event.action,
    actorType: event.actorType,
    actor: actorId ? { id: actorId, name: actorsById.get(actorId) ?? null } : null,
    previousState: event.previousState,
    resultingState: event.resultingState,
    safeReason: event.safeReason ?? null,
    occurredAt: event.occurredAt.toISOString(),
  };
}
