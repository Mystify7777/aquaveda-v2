import { ACCOUNT_STATES } from "./account-state.js";

/**
 * Governance audit event vocabulary and input validity.
 *
 * Source: ADR-0010 §14 (records #168) and Issue #172. An audit event is an
 * immutable fact: "this actor did this action to this account, moving it from
 * previousState to resultingState, for this reason, at this time". It is
 * separate from current account state (User) and never rewritten.
 *
 * VALIDATION BOUNDARY: `validateGovernanceEventInput` checks event-SHAPE
 * semantics only: required fields, vocabulary, actor rules, and the few facts
 * that follow from an action's own name (MUTE records a result of MUTED).
 * It does NOT validate lifecycle legality or authorization. It will accept a
 * well-formed event describing a move the account lifecycle would never
 * permit (for example a HARD_SUSPEND whose previousState is
 * PERMANENTLY_DELETED). Ensuring that the recorded (previousState,
 * resultingState) pair reflects an already-authorized, already-applied
 * transition is the responsibility of the mutation services (#174-#180), which
 * own the transition graph and authority rules. The audit service records
 * facts; it does not decide whether they were allowed.
 */

export const GOVERNANCE_ACTIONS = Object.freeze({
  MUTE: "MUTE",
  MUTE_LIFTED: "MUTE_LIFTED",
  HARD_SUSPEND: "HARD_SUSPEND",
  SUSPENSION_LIFTED: "SUSPENSION_LIFTED",
  APPEAL_SUBMITTED: "APPEAL_SUBMITTED",
  APPEAL_RESOLVED: "APPEAL_RESOLVED",
  ACCOUNT_DELETION_REQUESTED: "ACCOUNT_DELETION_REQUESTED",
  ACCOUNT_RECOVERED: "ACCOUNT_RECOVERED",
  ACCOUNT_PERMANENTLY_DELETED: "ACCOUNT_PERMANENTLY_DELETED",
  EXPERT_REVOKED: "EXPERT_REVOKED",
  EXPERT_RESTORED: "EXPERT_RESTORED",
});

export const ACTOR_TYPES = Object.freeze({ USER: "USER", SYSTEM: "SYSTEM" });

/** `previousState` / `resultingState` hold an account state or a role. */
export const STATE_KINDS = Object.freeze({ ACCOUNT_STATE: "ACCOUNT_STATE", ROLE: "ROLE" });
export const EXPERT_ROLE_STATES = Object.freeze(["EXPERT", "USER"]);

const { MUTED, HARD_SUSPENDED, DELETION_PENDING, PERMANENTLY_DELETED } = ACCOUNT_STATES;

/**
 * Per-action facts that follow from the action definition itself (ADR-0010):
 * - `previous` / `resulting`: required fixed value, when the action's meaning
 *   determines it. Absent means "any valid value of the state kind" (e.g. an
 *   appeal outcome, or a lift that may restore ACTIVE eligibility).
 * - `reasonRequired`: only EXPERT_REVOKED, where ADR-0010 §12 states a
 *   mandatory reason. Reason requirements for other actions are deferred to
 *   the issues that implement them.
 */
export const ACTION_SPECS = Object.freeze({
  MUTE: { kind: STATE_KINDS.ACCOUNT_STATE, resulting: MUTED },
  MUTE_LIFTED: { kind: STATE_KINDS.ACCOUNT_STATE, previous: MUTED },
  HARD_SUSPEND: { kind: STATE_KINDS.ACCOUNT_STATE, resulting: HARD_SUSPENDED },
  SUSPENSION_LIFTED: { kind: STATE_KINDS.ACCOUNT_STATE, previous: HARD_SUSPENDED },
  APPEAL_SUBMITTED: { kind: STATE_KINDS.ACCOUNT_STATE },
  APPEAL_RESOLVED: { kind: STATE_KINDS.ACCOUNT_STATE },
  ACCOUNT_DELETION_REQUESTED: { kind: STATE_KINDS.ACCOUNT_STATE, resulting: DELETION_PENDING },
  ACCOUNT_RECOVERED: { kind: STATE_KINDS.ACCOUNT_STATE, previous: DELETION_PENDING },
  ACCOUNT_PERMANENTLY_DELETED: {
    kind: STATE_KINDS.ACCOUNT_STATE,
    previous: DELETION_PENDING,
    resulting: PERMANENTLY_DELETED,
  },
  EXPERT_REVOKED: { kind: STATE_KINDS.ROLE, previous: "EXPERT", resulting: "USER", reasonRequired: true },
  EXPERT_RESTORED: { kind: STATE_KINDS.ROLE, previous: "USER", resulting: "EXPERT" },
});

/**
 * Persistence bounds only (unbounded free text is not acceptable). No approved
 * document specifies these numbers; they are implementation placeholders, not
 * governance policy.
 */
export const REASON_MAX_LENGTH = 2000;
export const SAFE_REASON_MAX_LENGTH = 500;
export const MAX_REFERENCES = 10;

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_.-]{1,200}$/;
/** Open vocabulary so new reference kinds need no migration (e.g. APPEAL, EVENT). */
export const REFERENCE_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,39}$/;

const OBJECT_ID = /^[a-f\d]{24}$/i;
export const isObjectIdLike = (v) =>
  (typeof v === "string" || (v && typeof v === "object")) && OBJECT_ID.test(String(v));
const isDate = (v) => v instanceof Date && !Number.isNaN(v.getTime());

const stateValuesFor = (kind) =>
  kind === STATE_KINDS.ROLE ? EXPERT_ROLE_STATES : Object.values(ACCOUNT_STATES);

/** Returns violations (empty = valid). Pure; accepts a plain object or document. */
export function validateGovernanceEventInput(input) {
  const errors = [];
  const e = input ?? {};
  const spec = ACTION_SPECS[e.action];

  if (!spec || !Object.prototype.hasOwnProperty.call(GOVERNANCE_ACTIONS, e.action)) {
    return [`action must be one of ${Object.values(GOVERNANCE_ACTIONS).join(", ")}`];
  }

  if (typeof e.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(e.idempotencyKey)) {
    errors.push("idempotencyKey is required (1-200 chars of A-Z a-z 0-9 : _ . -)");
  }

  if (!Object.values(ACTOR_TYPES).includes(e.actorType)) {
    errors.push(`actorType must be one of ${Object.values(ACTOR_TYPES).join(", ")}`);
  } else if (e.actorType === ACTOR_TYPES.USER) {
    if (!isObjectIdLike(e.actor)) errors.push("actor is required when actorType is USER");
  } else if (e.actor !== undefined && e.actor !== null) {
    errors.push("actor must be absent when actorType is SYSTEM");
  }

  if (!isObjectIdLike(e.target)) errors.push("target is required");

  const allowed = stateValuesFor(spec.kind);
  for (const field of ["previousState", "resultingState"]) {
    if (!allowed.includes(e[field])) {
      errors.push(`${field} must be one of ${allowed.join(", ")}`);
    }
  }
  if (spec.previous && e.previousState !== spec.previous) {
    errors.push(`${e.action} requires previousState ${spec.previous}`);
  }
  if (spec.resulting && e.resultingState !== spec.resulting) {
    errors.push(`${e.action} requires resultingState ${spec.resulting}`);
  }

  const reason = typeof e.reason === "string" ? e.reason.trim() : e.reason;
  if (reason === undefined || reason === null) {
    if (spec.reasonRequired) errors.push(`${e.action} requires a reason`);
  } else if (typeof reason !== "string" || reason.length === 0) {
    errors.push(spec.reasonRequired ? `${e.action} requires a non-empty reason` : "reason, when present, must be non-empty text");
  } else if (reason.length > REASON_MAX_LENGTH) {
    errors.push(`reason must be at most ${REASON_MAX_LENGTH} characters`);
  }

  if (e.safeReason !== undefined && e.safeReason !== null) {
    const safe = typeof e.safeReason === "string" ? e.safeReason.trim() : e.safeReason;
    if (typeof safe !== "string" || safe.length === 0) {
      errors.push("safeReason, when present, must be non-empty text");
    } else if (safe.length > SAFE_REASON_MAX_LENGTH) {
      errors.push(`safeReason must be at most ${SAFE_REASON_MAX_LENGTH} characters`);
    }
  }

  if (e.references !== undefined && e.references !== null) {
    if (!Array.isArray(e.references)) {
      errors.push("references must be an array");
    } else if (e.references.length > MAX_REFERENCES) {
      errors.push(`references must contain at most ${MAX_REFERENCES} entries`);
    } else {
      e.references.forEach((r, i) => {
        if (!r || !REFERENCE_TYPE_PATTERN.test(String(r.type ?? "")) || !isObjectIdLike(r.id)) {
          errors.push(`references[${i}] must be { type: UPPER_SNAKE_CASE, id: ObjectId }`);
        }
      });
    }
  }

  if (e.occurredAt !== undefined && e.occurredAt !== null && !isDate(e.occurredAt)) {
    errors.push("occurredAt must be a valid Date when provided");
  }

  return errors;
}

/**
 * Canonical content used to decide whether a retried write is the SAME logical
 * event. `occurredAt` is deliberately excluded: a retry may recompute it, and
 * the first recorded time wins.
 */
export function canonicalEventContent(e) {
  const norm = (v) => (v === undefined || v === null ? null : String(v));
  return JSON.stringify({
    action: e.action,
    actorType: e.actorType,
    actor: norm(e.actor),
    target: norm(e.target),
    previousState: e.previousState,
    resultingState: e.resultingState,
    reason: typeof e.reason === "string" ? e.reason.trim() || null : null,
    safeReason: typeof e.safeReason === "string" ? e.safeReason.trim() || null : null,
    references: (e.references ?? []).map((r) => [String(r.type), String(r.id)]),
  });
}
