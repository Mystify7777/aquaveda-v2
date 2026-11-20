import { recordGovernanceEvent } from "./governance-event.service.js";
import { DomainErrorCode } from "./errors.js";

/**
 * THE single seam between an account-state transition and its audit event.
 *
 * Every governance transition that changes `User` account state and must leave
 * a GovernanceEvent (MUTE, MUTE_LIFTED, HARD_SUSPEND, SUSPENSION_LIFTED, and
 * future #176/#177/#180 transitions) calls `recordTransitionEvent` AFTER its
 * conditional atomic state update. Nothing else in the codebase retries or
 * wraps event writes, so a durable consistency model (Issue #204: transaction,
 * outbox, or reconciliation) replaces this one function.
 *
 * Current behavior (the #174 model, deliberately unchanged by #207):
 *  - the state change is already committed (ADR-0006: no transactions);
 *  - the event write is retried (it is idempotent: the key derives from the
 *    transition's new `accountStateVersion`);
 *  - if it still fails the error is logged and rethrown and the state change is
 *    NOT rolled back. The failure mode is a missing audit event, never a false
 *    one. For expiry persistence a missing event cannot be reconstructed later
 *    from state alone; that gap is #204's scope.
 */

export const EVENT_WRITE_ATTEMPTS = 3;

export async function recordTransitionEvent(input) {
  let lastError;
  for (let attempt = 1; attempt <= EVENT_WRITE_ATTEMPTS; attempt += 1) {
    try {
      return await recordGovernanceEvent(input);
    } catch (err) {
      lastError = err;
      if (err?.code === DomainErrorCode.VALIDATION_FAILED || err?.details?.reason === "IDEMPOTENCY_KEY_CONFLICT") {
        break; // deterministic failure; retrying cannot help
      }
    }
  }
  console.error("[governance] audit event write failed AFTER state change", {
    action: input.action,
    target: String(input.target),
    key: input.idempotencyKey,
    name: lastError?.name,
  });
  throw lastError;
}
