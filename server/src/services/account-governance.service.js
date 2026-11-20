import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import { ACCOUNT_STATES } from "../domain/account-state.js";
import {
  RESTRICTION_KINDS,
  SAFE_REASON_MAX_LENGTH,
  isRestrictionExpired,
  validateAccountRecord,
} from "../domain/account-restriction.js";
import { ACTOR_TYPES, GOVERNANCE_ACTIONS, REASON_MAX_LENGTH } from "../domain/governance-event.js";
import { requireActor, requireRole } from "./authorization.js";
import { recordTransitionEvent } from "./governance-audit.js";
import {
  DomainError,
  DomainErrorCode,
  invalidState,
  notFound,
  stateRace,
} from "./errors.js";

/**
 * Account governance — MUTE (#174) and HARD_SUSPENDED (#207)
 * (ADR-0010 §2–§4, §13, §14).
 *
 * Every state change is ONE conditional atomic update on the User document
 * (filter pins the expected state AND `accountStateVersion`; `$inc`
 * `accountStateVersion` in the same write; the resulting record is checked
 * with `validateAccountRecord`), per ADR-0006 and the #171/#173 invariant. It
 * is followed by exactly one idempotent governance event through the shared
 * `recordTransitionEvent` seam (key `${action}:${target}:${newVersion}`).
 *
 * Legal transitions implemented here (ADR-0010 §1; others are deferred and are
 * therefore rejected with INVALID_STATE, never guessed):
 *
 *   ACTIVE         --mute------------> MUTED            (temporary only)
 *   MUTED          --lift / expiry---> ACTIVE
 *   ACTIVE         --suspend---------> HARD_SUSPENDED   (temporary | indefinite)
 *   HARD_SUSPENDED --lift / expiry---> ACTIVE
 *
 * Sessions (ADR-0010 §4): MUTE never touches sessions. HARD_SUSPENDED
 * invalidates all refresh sessions at the transition; lifting or expiring a
 * suspension invalidates any residual sessions BEFORE restoring eligibility so
 * an old session can never be resurrected; the user must log in again.
 */

const OBJECT_ID = /^[a-f\d]{24}$/i;
const STATE_PROJECTION = "accountState accountStateVersion accountRestriction";

/** Restriction families that share lift/expiry mechanics. */
const MUTE = Object.freeze({
  state: ACCOUNT_STATES.MUTED,
  liftAction: GOVERNANCE_ACTIONS.MUTE_LIFTED,
  invalidatesSessionsOnRestore: false,
  bumpsCredentialGeneration: false,
  label: "mute",
});
const SUSPENSION = Object.freeze({
  state: ACCOUNT_STATES.HARD_SUSPENDED,
  liftAction: GOVERNANCE_ACTIONS.SUSPENSION_LIFTED,
  invalidatesSessionsOnRestore: true,
  bumpsCredentialGeneration: true,
  label: "suspension",
});

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

function requiredText(value, field, max, errors) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim().length === 0)) {
    errors.push(`${field} is required`);
    return undefined;
  }
  return optionalText(value, field, max, errors);
}

function parseExpiry(value, now, errors) {
  const expiresAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(expiresAt.getTime())) errors.push("expiresAt must be a valid date");
  else if (expiresAt.getTime() <= now.getTime()) errors.push("expiresAt must be in the future");
  return expiresAt;
}

/** Filter fragments tolerant of pre-#173 documents that lack the stored fields. */
const stateFilter = (state) =>
  state === ACCOUNT_STATES.ACTIVE ? { accountState: { $in: [ACCOUNT_STATES.ACTIVE, null] } } : { accountState: state };
const versionFilter = (v) =>
  v === 0 ? { $or: [{ accountStateVersion: 0 }, { accountStateVersion: null }] } : { accountStateVersion: v };

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

/**
 * Counters bumped by the SAME atomic write that restores eligibility. For a
 * suspension this includes the credential generation, which invalidates every
 * access token issued before the restoration (ADR-0010 §4: restoration needs a
 * fresh session). It is bumped at restoration, not at suspension, so a stale
 * token still receives ACCOUNT_SUSPENDED while the account is suspended (the
 * #173 contract the client uses to reach the suspension surface), and only
 * stops being valid at all once the account is eligible again.
 */
function restoreIncrements(cfg) {
  return cfg.bumpsCredentialGeneration ? { accountStateVersion: 1, authGeneration: 1 } : { accountStateVersion: 1 };
}

/** Remove every refresh session of the account. Throws on failure. */
async function invalidateRefreshSessions(targetId) {
  await Session.deleteMany({ userId: targetId });
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

// --- apply -----------------------------------------------------------------

/**
 * MUTE an ACTIVE account until `expiresAt` (ADMIN only). Mute is always
 * temporary (ADR-0010 §2). No maximum duration is imposed; the private
 * `reason` is optional.
 */
export async function muteAccount(actorContext, targetId, input = {}, { now = new Date() } = {}) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");
  requireTargetId(targetId);

  const errors = [];
  const expiresAt = parseExpiry(input.expiresAt, now, errors);
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

  const { event } = await recordTransitionEvent({
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

/**
 * HARD_SUSPEND an ACTIVE account (ADMIN only).
 *
 * Input: `{ kind: "TEMPORARY" | "INDEFINITE", expiresAt?, reason, safeReason? }`.
 * `kind` is explicit so an indefinite suspension can never result from merely
 * omitting `expiresAt`: TEMPORARY requires a future `expiresAt`, INDEFINITE
 * forbids it. No maximum duration is imposed. The private `reason` is
 * required (a suspension must be accountable); `safeReason` is the optional
 * user-visible reason.
 *
 * Only an ACTIVE account is eligible. This is a conservative
 * implementation-level safety decision, NOT an ADR-0010 prohibition: ADR-0010
 * leaves unstated restriction-state transitions (including MUTED ->
 * HARD_SUSPENDED) deferred, so none is invented here. DELETION_PENDING and
 * PERMANENTLY_DELETED are separate lifecycle states; suspension of them is
 * likewise not permitted.
 *
 * All refresh sessions are invalidated after the state change. A failure of
 * that cleanup does not undo the suspension: the account is already blocked at
 * every authenticated path and a leftover session is inert (the refresh path
 * rejects and deletes it).
 */
export async function suspendAccount(actorContext, targetId, input = {}, { now = new Date() } = {}) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");
  requireTargetId(targetId);

  const errors = [];
  const kind = input.kind;
  if (!Object.values(RESTRICTION_KINDS).includes(kind)) {
    errors.push(`kind must be one of ${Object.values(RESTRICTION_KINDS).join(", ")}`);
  }
  let expiresAt;
  if (kind === RESTRICTION_KINDS.TEMPORARY) {
    if (input.expiresAt === undefined || input.expiresAt === null) errors.push("a TEMPORARY suspension requires expiresAt");
    else expiresAt = parseExpiry(input.expiresAt, now, errors);
  } else if (kind === RESTRICTION_KINDS.INDEFINITE && input.expiresAt !== undefined && input.expiresAt !== null) {
    errors.push("an INDEFINITE suspension must not have expiresAt");
  }
  const reason = requiredText(input.reason, "reason", REASON_MAX_LENGTH, errors);
  const safeReason = optionalText(input.safeReason, "safeReason", SAFE_REASON_MAX_LENGTH, errors);
  if (errors.length > 0) throw validationFailed(errors);

  const restriction = { kind };
  if (kind === RESTRICTION_KINDS.TEMPORARY) restriction.expiresAt = expiresAt;
  if (safeReason) restriction.safeReason = safeReason;
  const recordErrors = validateAccountRecord({
    accountState: ACCOUNT_STATES.HARD_SUSPENDED,
    accountStateChangedAt: now,
    accountRestriction: restriction,
  });
  if (recordErrors.length > 0) throw validationFailed(recordErrors);

  const target = await loadTarget(targetId);
  const currentState = target.accountState ?? ACCOUNT_STATES.ACTIVE;
  if (currentState !== ACCOUNT_STATES.ACTIVE) {
    throw invalidState("Only an ACTIVE account can be hard-suspended", { accountState: currentState });
  }
  const version = target.accountStateVersion ?? 0;

  const updated = await User.findOneAndUpdate(
    { _id: targetId, ...stateFilter(ACCOUNT_STATES.ACTIVE), ...versionFilter(version) },
    {
      $set: {
        accountState: ACCOUNT_STATES.HARD_SUSPENDED,
        accountStateChangedAt: now,
        accountRestriction: restriction,
      },
      $inc: { accountStateVersion: 1 },
    },
    { new: true },
  ).select(STATE_PROJECTION);
  if (!updated) throw await diagnoseZeroMatch(targetId);

  try {
    await invalidateRefreshSessions(targetId);
  } catch (err) {
    console.error("[governance] session cleanup failed after suspension", { target: String(targetId), name: err?.name });
  }

  const { event } = await recordTransitionEvent({
    idempotencyKey: `${GOVERNANCE_ACTIONS.HARD_SUSPEND}:${targetId}:${updated.accountStateVersion}`,
    action: GOVERNANCE_ACTIONS.HARD_SUSPEND,
    actorType: ACTOR_TYPES.USER,
    actor: actorContext.id,
    target: targetId,
    previousState: ACCOUNT_STATES.ACTIVE,
    resultingState: ACCOUNT_STATES.HARD_SUSPENDED,
    reason,
    safeReason,
    occurredAt: now,
  });
  return toResult(updated, event);
}

// --- lift (admin) ------------------------------------------------------------

async function liftRestriction(cfg, actorContext, targetId, input, now) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");
  requireTargetId(targetId);

  const errors = [];
  const reason = optionalText(input.reason, "reason", REASON_MAX_LENGTH, errors);
  if (errors.length > 0) throw validationFailed(errors);

  const target = await loadTarget(targetId);
  if (target.accountState !== cfg.state) {
    throw invalidState(`Only a ${cfg.state} account can have its ${cfg.label} lifted`, {
      accountState: target.accountState ?? ACCOUNT_STATES.ACTIVE,
    });
  }
  const version = target.accountStateVersion ?? 0;

  // Residual sessions must be gone BEFORE eligibility is restored (a failure
  // aborts the lift; the account simply stays restricted and the call can be
  // retried).
  if (cfg.invalidatesSessionsOnRestore) await invalidateRefreshSessions(targetId);

  const updated = await User.findOneAndUpdate(
    { _id: targetId, ...stateFilter(cfg.state), ...versionFilter(version) },
    {
      $set: { accountState: ACCOUNT_STATES.ACTIVE, accountStateChangedAt: now },
      $unset: { accountRestriction: "" },
      $inc: restoreIncrements(cfg),
    },
    { new: true },
  ).select(STATE_PROJECTION);
  if (!updated) throw await diagnoseZeroMatch(targetId);

  const { event } = await recordTransitionEvent({
    idempotencyKey: `${cfg.liftAction}:${targetId}:${updated.accountStateVersion}`,
    action: cfg.liftAction,
    actorType: ACTOR_TYPES.USER,
    actor: actorContext.id,
    target: targetId,
    previousState: cfg.state,
    resultingState: ACCOUNT_STATES.ACTIVE,
    reason,
    occurredAt: now,
  });
  return toResult(updated, event);
}

/** Lift a MUTE early (ADMIN only). The target must currently be MUTED. */
export function liftMute(actorContext, targetId, input = {}, { now = new Date() } = {}) {
  return liftRestriction(MUTE, actorContext, targetId, input, now);
}

/** Lift a HARD_SUSPENDED state early (ADMIN only). The target must currently be HARD_SUSPENDED. */
export function liftSuspension(actorContext, targetId, input = {}, { now = new Date() } = {}) {
  return liftRestriction(SUSPENSION, actorContext, targetId, input, now);
}

// --- expiry (server-side) -----------------------------------------------------

/**
 * Persist the lift of a restriction that has expired (SYSTEM actor).
 * Idempotent and race-safe: the conditional filter requires the same version,
 * state, and an expired TEMPORARY restriction, so concurrent callers (many
 * requests, a login, an Admin lift, a sweep) produce at most one transition and
 * one event. `occurredAt` is the restriction's `expiresAt`. INDEFINITE
 * restrictions never match. Returns `{ lifted: boolean }`.
 */
async function expireRestrictionIfDue(cfg, targetId, now) {
  requireTargetId(targetId);
  const target = await User.findById(targetId).select(STATE_PROJECTION);
  if (!target || target.accountState !== cfg.state) return { lifted: false };
  const restriction = target.accountRestriction;
  if (!isRestrictionExpired(restriction, now)) return { lifted: false };
  const version = target.accountStateVersion ?? 0;
  const expiredAt = restriction.expiresAt;

  if (cfg.invalidatesSessionsOnRestore) await invalidateRefreshSessions(targetId);

  const updated = await User.findOneAndUpdate(
    {
      _id: targetId,
      ...stateFilter(cfg.state),
      ...versionFilter(version),
      "accountRestriction.kind": RESTRICTION_KINDS.TEMPORARY,
      "accountRestriction.expiresAt": { $lte: now },
    },
    {
      $set: { accountState: ACCOUNT_STATES.ACTIVE, accountStateChangedAt: now },
      $unset: { accountRestriction: "" },
      $inc: restoreIncrements(cfg),
    },
    { new: true },
  ).select(STATE_PROJECTION);
  if (!updated) return { lifted: false }; // another actor already moved the account

  await recordTransitionEvent({
    idempotencyKey: `${cfg.liftAction}:${targetId}:${updated.accountStateVersion}`,
    action: cfg.liftAction,
    actorType: ACTOR_TYPES.SYSTEM,
    target: targetId,
    previousState: cfg.state,
    resultingState: ACCOUNT_STATES.ACTIVE,
    occurredAt: expiredAt,
  });
  return { lifted: true };
}

export const expireMuteIfDue = (targetId, { now = new Date() } = {}) => expireRestrictionIfDue(MUTE, targetId, now);
export const expireSuspensionIfDue = (targetId, { now = new Date() } = {}) =>
  expireRestrictionIfDue(SUSPENSION, targetId, now);

/** Expire whichever restriction the account currently carries (request-path hook). */
export async function expireAccountRestrictionIfDue(targetId, { now = new Date() } = {}) {
  const target = await User.findById(targetId).select("accountState");
  if (target?.accountState === ACCOUNT_STATES.MUTED) return expireRestrictionIfDue(MUTE, targetId, now);
  if (target?.accountState === ACCOUNT_STATES.HARD_SUSPENDED) return expireRestrictionIfDue(SUSPENSION, targetId, now);
  return { lifted: false };
}

async function sweep(cfg, { now, limit }) {
  const due = await User.find({
    accountState: cfg.state,
    "accountRestriction.expiresAt": { $lte: now },
  })
    .select("_id")
    .limit(limit)
    .lean();
  let lifted = 0;
  for (const { _id } of due) {
    if ((await expireRestrictionIfDue(cfg, _id, now)).lifted) lifted += 1;
  }
  return { examined: due.length, lifted };
}

/**
 * Housekeeping sweeps via the `account_restriction_expiry` access path.
 * Enforcement never depends on them (effective state is computed per request
 * and at login); they only tidy stored state and history for accounts that do
 * not return. Nothing schedules them yet.
 */
export const liftExpiredMutes = ({ now = new Date(), limit = 100 } = {}) => sweep(MUTE, { now, limit });
export const liftExpiredSuspensions = ({ now = new Date(), limit = 100 } = {}) => sweep(SUSPENSION, { now, limit });
