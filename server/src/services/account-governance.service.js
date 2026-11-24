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
import { NOT_ADMIN_FILTER, adminTargetingViolation } from "../domain/admin-targeting.js";
import { requireActor, requireRole } from "./authorization.js";
import { recordTransitionEvent } from "./governance-audit.js";
import {
  DomainError,
  DomainErrorCode,
  forbidden,
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
 * Administrator targeting (ADR-0012 D2/D8, #255; docs/architecture/admin-targeting-enforcement.md):
 * every PRODUCT operation (mute, suspend, both lifts) is rejected with 403
 * FORBIDDEN when the target is the actor (`SELF_TARGET_PROHIBITED`) or any other
 * ADMIN in any state (`ADMIN_TARGET_PROTECTED`). Order: ADMIN actor -> target id
 * -> load target (404) -> TARGET PROTECTION -> state preconditions. The check is
 * made on the pre-read AND pinned in the atomic write (`role` not ADMIN, plus
 * state and `accountStateVersion`), so a role change between read and write is
 * a zero-match resolved to STATE_RACE/NOT_FOUND, never FORBIDDEN and never a
 * mutation. SYSTEM expiry is NOT subject to this rule (ADR-0012 D2).
 *
 * Sessions and credentials (ADR-0010 §4; protocol and guarantees in
 * docs/architecture/hard-suspension.md, "Restoration and session-cleanup
 * protocol", #217/#219): MUTE never touches sessions or the credential
 * generation. A suspension restoration bumps `User.authGeneration` in the same
 * atomic write that restores eligibility; `refresh()` rejects any session whose
 * generation is not current, so a pre-suspension credential is dead the instant
 * that write commits. Only the WINNER of the conditional update then deletes
 * stale sessions, bound to the generation it restored (`<= restoredGen`), so no
 * stale, delayed or duplicate cleanup can ever match a later session. Cleanup is
 * best-effort and never throws; security never depends on it running.
 */

/**
 * Inert test seams (never assigned in production). Tests assign async
 * functions to force exact interleavings with explicit barriers:
 *  - afterRead({ phase, mode, label, targetId }): after a restoration's read and
 *    precondition check, before its conditional update.
 *  - afterFlip({ phase, ... }): after a winning update, before cleanup.
 *  - beforeCleanup({ phase, ... }): immediately before session cleanup; may throw
 *    to simulate cleanup failure.
 * `phase` is "restore" or "suspend".
 *  - afterTargetRead({ operation, targetId }): after mute/suspend's pre-read and
 *    protection/state checks, before their conditional update (#255). Lifts use
 *    `afterRead` (mode "admin"), which already sits at the same point.
 */
export const governanceTestHooks = {
  afterRead: undefined,
  afterFlip: undefined,
  beforeCleanup: undefined,
  afterTargetRead: undefined,
};

async function runHook(name, ctx) {
  const hook = governanceTestHooks[name];
  if (typeof hook === "function") await hook(ctx);
}

const OBJECT_ID = /^[a-f\d]{24}$/i;
const STATE_PROJECTION = "role accountState accountStateVersion accountRestriction authGeneration";

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

/**
 * ADR-0012 D2/D8: throws the exact documented 403 for a self or Admin target.
 * Evaluated on the pre-read, before every state-dependent check. A zero-match
 * on the write never reaches here (it never infers FORBIDDEN).
 */
function assertTargetNotProtected(actorContext, target) {
  const reason = adminTargetingViolation({ actorId: actorContext.id, target });
  if (!reason) return;
  throw forbidden(
    reason === "SELF_TARGET_PROHIBITED"
      ? "An administrator cannot apply governance operations to their own account"
      : "Administrator accounts cannot be restricted or restored through this operation",
    { reason },
  );
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

/**
 * Delete the account's sessions bound to credential generations `<= maxGeneration`
 * (absent counts as 0). Generations only increase, so a session issued after
 * the restoration that produced `maxGeneration + 1` can never match.
 */
function deleteSessionsUpToGeneration(targetId, maxGeneration) {
  return Session.deleteMany({ userId: targetId, authGeneration: { $not: { $gt: maxGeneration } } });
}

/** Best-effort, never throws: security does not depend on cleanup (see header). */
async function cleanupSessions(ctx, targetId, maxGeneration) {
  try {
    await runHook("beforeCleanup", { ...ctx, targetId });
    await deleteSessionsUpToGeneration(targetId, maxGeneration);
  } catch (err) {
    console.error("[governance] session cleanup failed (credentials stay invalid by generation)", {
      target: String(targetId),
      phase: ctx.phase,
      name: err?.name,
    });
  }
}

/**
 * Reconciliation / recovery: delete sessions older than the user's CURRENT
 * credential generation. Idempotent and monotonicity-safe: a session created
 * concurrently carries a generation >= the one read here, so it cannot match.
 */
export async function purgeStaleSessions(targetId) {
  requireTargetId(targetId);
  const user = await User.findById(targetId).select("authGeneration");
  const generation = user?.authGeneration ?? 0;
  if (generation <= 0) return { deleted: 0 };
  const result = await Session.deleteMany({ userId: targetId, authGeneration: { $not: { $gte: generation } } });
  return { deleted: result.deletedCount ?? 0 };
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
  assertTargetNotProtected(actorContext, target);
  const currentState = target.accountState ?? ACCOUNT_STATES.ACTIVE;
  if (currentState !== ACCOUNT_STATES.ACTIVE) {
    throw invalidState("Only an ACTIVE account can be muted", { accountState: currentState });
  }
  const version = target.accountStateVersion ?? 0;
  await runHook("afterTargetRead", { operation: "mute", targetId });

  const updated = await User.findOneAndUpdate(
    { _id: targetId, ...NOT_ADMIN_FILTER, ...stateFilter(ACCOUNT_STATES.ACTIVE), ...versionFilter(version) },
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
  assertTargetNotProtected(actorContext, target);
  const currentState = target.accountState ?? ACCOUNT_STATES.ACTIVE;
  if (currentState !== ACCOUNT_STATES.ACTIVE) {
    throw invalidState("Only an ACTIVE account can be hard-suspended", { accountState: currentState });
  }
  const version = target.accountStateVersion ?? 0;
  await runHook("afterTargetRead", { operation: "suspend", targetId });

  const updated = await User.findOneAndUpdate(
    { _id: targetId, ...NOT_ADMIN_FILTER, ...stateFilter(ACCOUNT_STATES.ACTIVE), ...versionFilter(version) },
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

  // Bound to the generation at this suspending write: a delayed cleanup here can
  // never delete a session issued after a later restoration (G2).
  const suspendCtx = { phase: "suspend", mode: "suspend", label: SUSPENSION.label };
  await runHook("afterFlip", { ...suspendCtx, targetId });
  await cleanupSessions(suspendCtx, targetId, updated.authGeneration ?? 0);

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

// --- restoration (one protocol for Admin lift, request/login expiry, sweep) ----

/**
 * The single restoration core. read -> ONE conditional atomic update -> cleanup
 * -> event. Only the actor whose conditional update wins proceeds past it; a
 * loser deletes nothing (G1). `mode`:
 *  - "admin": ADMIN lift; preconditions reported as INVALID_STATE, a lost race
 *    as the existing state-race/not-found errors.
 *  - "expiry": SYSTEM; not-due / not-in-state / lost race all return
 *    `{ lifted: false }`.
 */
async function restoreAccount(cfg, targetId, { mode, actorContext = null, reason, now }) {
  const target = await User.findById(targetId).select(STATE_PROJECTION);
  const state = target ? (target.accountState ?? ACCOUNT_STATES.ACTIVE) : undefined;

  let expiredAt;
  if (mode === "expiry") {
    if (!target || state !== cfg.state || !isRestrictionExpired(target.accountRestriction, now)) {
      return { lifted: false };
    }
    expiredAt = target.accountRestriction.expiresAt;
  } else {
    if (!target) throw notFound("Account not found");
    assertTargetNotProtected(actorContext, target);
    if (state !== cfg.state) {
      throw invalidState(`Only a ${cfg.state} account can have its ${cfg.label} lifted`, { accountState: state });
    }
  }
  const version = target.accountStateVersion ?? 0;
  const ctx = { phase: "restore", mode, label: cfg.label };
  await runHook("afterRead", { ...ctx, targetId });

  const filter = { _id: targetId, ...stateFilter(cfg.state), ...versionFilter(version) };
  // Product lifts pin the role too (ADR-0012 D8); SYSTEM expiry may lift an Admin's restriction (D2).
  if (mode === "admin") Object.assign(filter, NOT_ADMIN_FILTER);
  if (mode === "expiry") {
    filter["accountRestriction.kind"] = RESTRICTION_KINDS.TEMPORARY;
    filter["accountRestriction.expiresAt"] = { $lte: now };
  }
  const updated = await User.findOneAndUpdate(
    filter,
    {
      $set: { accountState: ACCOUNT_STATES.ACTIVE, accountStateChangedAt: now },
      $unset: { accountRestriction: "" },
      $inc: restoreIncrements(cfg),
    },
    { new: true },
  ).select(STATE_PROJECTION);

  if (!updated) {
    if (mode === "expiry") return { lifted: false }; // lost: no cleanup, no event (G1)
    throw await diagnoseZeroMatch(targetId);
  }

  await runHook("afterFlip", { ...ctx, targetId });
  if (cfg.invalidatesSessionsOnRestore) {
    // The generation being restored is the value BEFORE this write's bump.
    await cleanupSessions(ctx, targetId, (updated.authGeneration ?? 1) - 1);
  }

  const { event } = await recordTransitionEvent({
    idempotencyKey: `${cfg.liftAction}:${targetId}:${updated.accountStateVersion}`,
    action: cfg.liftAction,
    actorType: mode === "admin" ? ACTOR_TYPES.USER : ACTOR_TYPES.SYSTEM,
    ...(mode === "admin" ? { actor: actorContext.id } : {}),
    target: targetId,
    previousState: cfg.state,
    resultingState: ACCOUNT_STATES.ACTIVE,
    ...(reason ? { reason } : {}),
    occurredAt: mode === "admin" ? now : expiredAt,
  });
  return mode === "admin" ? toResult(updated, event) : { lifted: true };
}

async function liftRestriction(cfg, actorContext, targetId, input, now) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");
  requireTargetId(targetId);

  const errors = [];
  const reason = optionalText(input.reason, "reason", REASON_MAX_LENGTH, errors);
  if (errors.length > 0) throw validationFailed(errors);

  return restoreAccount(cfg, targetId, { mode: "admin", actorContext, reason, now });
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
 * Persist the lift of a restriction that has expired (SYSTEM actor), through the
 * same restoration core as an Admin lift. Idempotent and race-safe; INDEFINITE
 * restrictions never match. `occurredAt` is the restriction's `expiresAt`.
 * Returns `{ lifted: boolean }`.
 */
async function expireRestrictionIfDue(cfg, targetId, now) {
  requireTargetId(targetId);
  return restoreAccount(cfg, targetId, { mode: "expiry", now });
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
