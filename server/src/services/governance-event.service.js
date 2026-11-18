import { GovernanceEvent } from "../models/GovernanceEvent.js";
import "../models/User.js"; // model registration for refs
import {
  canonicalEventContent,
  validateGovernanceEventInput,
} from "../domain/governance-event.js";
import { DomainError, DomainErrorCode, invalidState, notFound } from "./errors.js";

/**
 * Governance audit event service (#172, ADR-0010 §14).
 *
 * Deliberately exposes ONLY append and read-by-id. There is no update, delete,
 * or bulk API, and none will be added: audit events are immutable.
 *
 * This is trusted internal infrastructure called by the governance mutation
 * services (#174-#180) AFTER they have authorized and applied an action. It
 * performs no authorization and no HTTP concerns, and it does not change
 * account state. It validates event shape, NOT lifecycle legality: callers own
 * the guarantee that the recorded state pair reflects a real, permitted
 * transition (see domain/governance-event.js).
 *
 * Retry / duplicate behavior (defined here, tested in
 * tests/governance-event.test.js):
 *  - Callers supply a required `idempotencyKey` identifying the logical action.
 *    A deterministic derivation is recommended, e.g.
 *    `${action}:${targetId}:${accountStateVersionAfterTransition}`, so a retried
 *    transition reuses the key.
 *  - First write with a key inserts the event -> `{ event, created: true }`.
 *  - A repeat with the same key and the same content (action, actor, target,
 *    states, reasons, references; `occurredAt` ignored) returns the ORIGINAL
 *    event -> `{ event, created: false }`. No second event is stored, including
 *    under concurrent retries (unique index arbitrates).
 *  - A repeat with the same key but DIFFERENT content is rejected
 *    (INVALID_STATE, details.reason = "IDEMPOTENCY_KEY_CONFLICT"); the stored
 *    event is never altered.
 */

function toPayload(input) {
  const payload = {
    idempotencyKey: input.idempotencyKey,
    action: input.action,
    actorType: input.actorType,
    target: input.target,
    previousState: input.previousState,
    resultingState: input.resultingState,
  };
  if (input.actor !== undefined && input.actor !== null) payload.actor = input.actor;
  if (typeof input.reason === "string") payload.reason = input.reason;
  if (typeof input.safeReason === "string") payload.safeReason = input.safeReason;
  if (Array.isArray(input.references) && input.references.length > 0) {
    payload.references = input.references.map((r) => ({ type: r.type, id: r.id }));
  }
  if (input.occurredAt) payload.occurredAt = input.occurredAt;
  return payload;
}

const isIdempotencyDuplicate = (err) =>
  err?.code === 11000 && (err.keyPattern?.idempotencyKey || /idempotencyKey/.test(err.message ?? ""));

export async function recordGovernanceEvent(input) {
  const errors = validateGovernanceEventInput(input);
  if (errors.length > 0) {
    throw new DomainError(DomainErrorCode.VALIDATION_FAILED, "Invalid governance event", { errors });
  }

  try {
    const event = await GovernanceEvent.create(toPayload(input));
    return { event, created: true };
  } catch (err) {
    if (isIdempotencyDuplicate(err)) {
      const existing = await GovernanceEvent.findOne({ idempotencyKey: input.idempotencyKey });
      if (!existing) throw err;
      if (canonicalEventContent(existing) === canonicalEventContent(input)) {
        return { event: existing, created: false };
      }
      throw invalidState("idempotencyKey was already used for a different governance event", {
        reason: "IDEMPOTENCY_KEY_CONFLICT",
      });
    }
    if (err?.name === "ValidationError") {
      throw new DomainError(DomainErrorCode.VALIDATION_FAILED, "Invalid governance event", {
        errors: Object.values(err.errors).map((e) => e.message),
      });
    }
    throw err;
  }
}

/** Internal read by id (lets a governance action resolve its referenced event). */
export async function getGovernanceEvent(eventId) {
  let event;
  try {
    event = await GovernanceEvent.findById(eventId);
  } catch (err) {
    if (err?.name === "CastError") {
      throw new DomainError(DomainErrorCode.VALIDATION_FAILED, "Invalid governance event id");
    }
    throw err;
  }
  if (!event) throw notFound("Governance event not found");
  return event;
}
