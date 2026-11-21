import { User } from "../models/User.js";
import { ACCOUNT_STATES } from "../domain/account-state.js";
import {
  RESTRICTION_KINDS,
  SAFE_REASON_MAX_LENGTH,
  isRestrictionExpired,
  validateAccountRecord,
} from "../domain/account-restriction.js";
import { ACTOR_TYPES, GOVERNANCE_ACTIONS, REASON_MAX_LENGTH } from "../domain/governance-event.js";
import { requireActor, requireRole } from "./authorization.js";
import { recordGovernanceEvent } from "./governance-event.service.js";
import {
  DomainError,
  DomainErrorCode,
  invalidState,
  notFound,
  stateRace,
} from "./errors.js";

/**
 * Account governance — MUTE (#174; ADR-0010 §2, §4, §13, §14).
 *
 * Operations: muteAccount, liftMute (ADMIN only), expireMuteIfDue /
 * liftExpiredMutes (server-side expiry, SYSTEM actor).
 *
 * Every state change is ONE conditional atomic update on the User document
 * (filter pins the expected state AND `accountStateVersion`; `$inc`
 * `accountStateVersion` in the same write; the resulting record is checked
 * with `validateAccountRecord`), per ADR-0006 and the #171/#173 invariant. It
 * is followed by exactly one idempotent governance event whose key is derived
 * from the NEW version (`${action}:${target}:${version}`), so a repeated
 * attempt can never produce a second event for the same transition.
 *
 * Sessions are NOT invalidated by MUTE (ADR-0010 §4): contribution
 * authorization is evaluated per request from current state.
 *
 * Known limitation (no transactions, ADR-0006): the state write and the event
 * write are two operations. The event write is retried (idempotent), and if it
 * still fails the error is surfaced after logging; the state change is NOT
 * rolled back, so a failure here leaves a missing audit event rather than a
 * false one. Recorded in docs/architecture/mute-enforcement.md.
 */

const OBJECT_ID = /^[a-f\d]{24}$/i;
const EVENT_WRITE_ATTEMPTS = 3;

const STATE_PROJECTION = "accountState accountStateVersion accountRestriction";

function validationFailed(errors) {
  return new DomainError(DomainErrorCode.VALIDATION_FAILED, "Invalid account governance request", { errors });
}

function requireTargetId(targetId) {
  if (!OBJECT_ID.test(String(targetId ?? ""))) throw validationFailed(["target id is invalid"]);
}

function optionalText(value, field, max, errors) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field}, when present, must be non-empty text`);
    return undefined;
  }
  if (value.trim().length > max) errors.push(`${field} must be at most ${max} characters`);
  return value.trim();
}

/** Filter fragments tolerant of pre-#173 documents that lack the stored fields. */
const stateFilter = (state) =>
  state === ACCOUNT_STATES.ACTIVE ? { accountState: { $in: [ACCOUNT_STATES.ACTIVE, null] } } : { accountState: state };
const versionFilter = (v) =>
  v === 0 ? { $or: [{ accountStateVersion: 0 }, { accountStateVersion: null }] } : { accountStateVersion: v };

async function recordEventWithRetry(input) {
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

async function loadTarget(targetId) {
  const target = await User.findById(targetId).select(STATE_PROJECTION);
  if (!target) throw notFound("Account not found");
  return target;
}

async function diagnoseZeroMatch(targetId) {
  const exists = await User.exists({ _id: targetId });
  if (!exists) return notFound("Account not found");
  return stateRace("The account changed before the operation completed; reload and retry");
}

function toResult(user, event) {
  return {
    id: String(user._id),
    accountState: user.accountState,
    accountStateVersion: user.accountStateVersion,
    restriction: user.accountRestriction
      ? {
          kind: user.accountRestriction.kind,
          expiresAt: user.accountRestriction.expiresAt ?? null,
          safeReason: user.accountRestriction.safeReason ?? null,
        }
      : null,
    eventId: String(event._id),
  };
}

/**
 * MUTE an ACTIVE account until `expiresAt` (ADMIN only). Mute is always
 * temporary (ADR-0010 §2): `expiresAt` must be in the future. No maximum
 * duration is imposed (none is specified); the private `reason` is optional.
 */
export async function muteAccount(actorContext, targetId, input = {}, { now = new Date() } = {}) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");
  requireTargetId(targetId);

  const errors = [];
  const expiresAt = input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) errors.push("expiresAt must be a valid date");
  else if (expiresAt.getTime() <= now.getTime()) errors.push("expiresAt must be in the future");
  const reason = optionalText(input.reason, "reason", REASON_MAX_LENGTH, errors);
  const safeReason = optionalText(input.safeReason, "safeReason", SAFE_REASON_MAX_LENGTH, errors);
  if (errors.length > 0) throw validationFailed(errors);

  const restriction = { kind: RESTRICTION_KINDS.TEMPORARY, expiresAt };
  if (safeReason) restriction.safeReason = safeReason;
  const recordErrors = validateAccountRecord({
    accountState: ACCOUNT_STATES.MUTED,
    accountStateChangedAt: now,
    accountRestriction: restriction,
  });
  if (recordErrors.length > 0) throw validationFailed(recordErrors);

  const target = await loadTarget(targetId);
  const currentState = target.accountState ?? ACCOUNT_STATES.ACTIVE;
  if (currentState !== ACCOUNT_STATES.ACTIVE) {
    throw invalidState("Only an ACTIVE account can be muted", { accountState: currentState });
  }
  const version = target.accountStateVersion ?? 0;

  const updated = await User.findOneAndUpdate(
    { _id: targetId, ...stateFilter(ACCOUNT_STATES.ACTIVE), ...versionFilter(version) },
    {
      $set: {
        accountState: ACCOUNT_STATES.MUTED,
        accountStateChangedAt: now,
        accountRestriction: restriction,
      },
      $inc: { accountStateVersion: 1 },
    },
    { new: true },
  ).select(STATE_PROJECTION);
  if (!updated) throw await diagnoseZeroMatch(targetId);

  const { event } = await recordEventWithRetry({
    idempotencyKey: `${GOVERNANCE_ACTIONS.MUTE}:${targetId}:${updated.accountStateVersion}`,
    action: GOVERNANCE_ACTIONS.MUTE,
    actorType: ACTOR_TYPES.USER,
    actor: actorContext.id,
    target: targetId,
    previousState: ACCOUNT_STATES.ACTIVE,
    resultingState: ACCOUNT_STATES.MUTED,
    reason,
    safeReason,
    occurredAt: now,
  });
  return toResult(updated, event);
}

/** Lift a MUTE early (ADMIN only). The target must currently be MUTED. */
export async function liftMute(actorContext, targetId, input = {}, { now = new Date() } = {}) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");
  requireTargetId(targetId);

  const errors = [];
  const reason = optionalText(input.reason, "reason", REASON_MAX_LENGTH, errors);
  if (errors.length > 0) throw validationFailed(errors);

  const target = await loadTarget(targetId);
  if (target.accountState !== ACCOUNT_STATES.MUTED) {
    throw invalidState("Only a MUTED account can have a mute lifted", {
      accountState: target.accountState ?? ACCOUNT_STATES.ACTIVE,
    });
  }
  const version = target.accountStateVersion ?? 0;

  const updated = await User.findOneAndUpdate(
    { _id: targetId, ...stateFilter(ACCOUNT_STATES.MUTED), ...versionFilter(version) },
    {
      $set: { accountState: ACCOUNT_STATES.ACTIVE, accountStateChangedAt: now },
      $unset: { accountRestriction: "" },
      $inc: { accountStateVersion: 1 },
    },
    { new: true },
  ).select(STATE_PROJECTION);
  if (!updated) throw await diagnoseZeroMatch(targetId);

  const { event } = await recordEventWithRetry({
    idempotencyKey: `${GOVERNANCE_ACTIONS.MUTE_LIFTED}:${targetId}:${updated.accountStateVersion}`,
    action: GOVERNANCE_ACTIONS.MUTE_LIFTED,
    actorType: ACTOR_TYPES.USER,
    actor: actorContext.id,
    target: targetId,
    previousState: ACCOUNT_STATES.MUTED,
    resultingState: ACCOUNT_STATES.ACTIVE,
    reason,
    occurredAt: now,
  });
  return toResult(updated, event);
}

/**
 * Persist the lift of a mute that has expired (SYSTEM actor). Idempotent and
 * race-safe: the conditional filter requires the same version, state, and an
 * expired TEMPORARY restriction, so concurrent callers (many requests from one
 * user, an Admin lift, a sweep) produce at most one transition and one event.
 * `occurredAt` is the restriction's `expiresAt` (when the mute actually ended).
 * Returns `{ lifted: boolean }`.
 */
export async function expireMuteIfDue(targetId, { now = new Date() } = {}) {
  requireTargetId(targetId);
  const target = await User.findById(targetId).select(STATE_PROJECTION);
  if (!target || target.accountState !== ACCOUNT_STATES.MUTED) return { lifted: false };
  const restriction = target.accountRestriction;
  if (!isRestrictionExpired(restriction, now)) return { lifted: false };
  const version = target.accountStateVersion ?? 0;
  const expiredAt = restriction.expiresAt;

  const updated = await User.findOneAndUpdate(
    {
      _id: targetId,
      ...stateFilter(ACCOUNT_STATES.MUTED),
      ...versionFilter(version),
      "accountRestriction.kind": RESTRICTION_KINDS.TEMPORARY,
      "accountRestriction.expiresAt": { $lte: now },
    },
    {
      $set: { accountState: ACCOUNT_STATES.ACTIVE, accountStateChangedAt: now },
      $unset: { accountRestriction: "" },
      $inc: { accountStateVersion: 1 },
    },
    { new: true },
  ).select(STATE_PROJECTION);
  if (!updated) return { lifted: false }; // another actor already moved the account

  await recordEventWithRetry({
    idempotencyKey: `${GOVERNANCE_ACTIONS.MUTE_LIFTED}:${targetId}:${updated.accountStateVersion}`,
    action: GOVERNANCE_ACTIONS.MUTE_LIFTED,
    actorType: ACTOR_TYPES.SYSTEM,
    target: targetId,
    previousState: ACCOUNT_STATES.MUTED,
    resultingState: ACCOUNT_STATES.ACTIVE,
    occurredAt: expiredAt,
  });
  return { lifted: true };
}

/**
 * Sweep: persist the lift for every account whose mute has expired. Uses the
 * `account_restriction_expiry` access path. Enforcement never depends on this
 * (the effective state is computed per request); it only keeps stored state and
 * history tidy for accounts that do not return. Nothing schedules it yet.
 */
export async function liftExpiredMutes({ now = new Date(), limit = 100 } = {}) {
  const due = await User.find({
    accountState: ACCOUNT_STATES.MUTED,
    "accountRestriction.expiresAt": { $lte: now },
  })
    .select("_id")
    .limit(limit)
    .lean();
  let lifted = 0;
  for (const { _id } of due) {
    if ((await expireMuteIfDue(_id, { now })).lifted) lifted += 1;
  }
  return { examined: due.length, lifted };
}
