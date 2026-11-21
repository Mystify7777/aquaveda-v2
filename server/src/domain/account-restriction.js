import { ACCOUNT_STATES } from "./account-state.js";

/**
 * Current account restriction metadata and the persistence-level validity of
 * (accountState, accountRestriction, accountStateChangedAt) combinations.
 *
 * Source: ADR-0010 §1–§3, §9–§10 (records #168). This module defines which
 * *stored* combinations are valid. It is NOT a transition graph: which state
 * may follow which is governance policy owned by the mutation issues
 * (#174–#180), and ADR-0010 leaves several transitions deferred.
 *
 * Governance history (who/why/when, previousState) is a separate append-only
 * concern (#172) and never lives here. No private moderation notes are stored
 * on the User; `safeReason` is the only free-text field and is, by name and
 * contract, the user-visible reason.
 */

export const RESTRICTION_KINDS = Object.freeze({
  TEMPORARY: "TEMPORARY",
  INDEFINITE: "INDEFINITE",
});

/**
 * Persistence bound only (unbounded free text is not acceptable). No approved
 * document specifies this number; it is an implementation placeholder, not a
 * governance policy, and may be revisited by the issue that defines the
 * "safe reason" contract (ADR-0010 Deferred: what counts as safe).
 */
export const SAFE_REASON_MAX_LENGTH = 500;

/** States whose current restriction is described by `accountRestriction`. */
export const RESTRICTION_BEARING_STATES = Object.freeze(
  new Set([ACCOUNT_STATES.MUTED, ACCOUNT_STATES.HARD_SUSPENDED]),
);

/** PERMANENTLY_DELETED is terminal (ADR-0010 §1). */
export function isTerminalAccountState(state) {
  return state === ACCOUNT_STATES.PERMANENTLY_DELETED;
}

const isDate = (v) => v instanceof Date && !Number.isNaN(v.getTime());

/**
 * Server-side expiry semantics: a TEMPORARY restriction is expired once
 * `expiresAt` is reached. INDEFINITE restrictions never expire by time.
 * Pure; evaluating or acting on expiry is a mutation-issue concern.
 */
export function isRestrictionExpired(restriction, now = new Date()) {
  if (!restriction || restriction.kind !== RESTRICTION_KINDS.TEMPORARY) return false;
  if (!isDate(restriction.expiresAt)) return false;
  return restriction.expiresAt.getTime() <= now.getTime();
}

/**
 * Returns a list of human-readable violations (empty = valid).
 * Accepts a plain object or a Mongoose document.
 *
 * | state                | accountRestriction                         | accountStateChangedAt |
 * | -------------------- | ------------------------------------------ | --------------------- |
 * | ACTIVE               | absent                                     | optional              |
 * | MUTED                | required; TEMPORARY with expiresAt         | required              |
 * | HARD_SUSPENDED       | required; TEMPORARY+expiresAt | INDEFINITE | required              |
 * |                      | (INDEFINITE has no expiresAt)              |                       |
 * | DELETION_PENDING     | absent (see note)                          | required              |
 * | PERMANENTLY_DELETED  | absent                                     | required              |
 *
 * Note: how an outstanding suspension is represented while an account is
 * DELETION_PENDING is deferred by ADR-0010; until decided it is not storable.
 */
export function validateAccountRecord(record) {
  const errors = [];
  const state = record?.accountState;
  const restriction = record?.accountRestriction ?? undefined;
  const changedAt = record?.accountStateChangedAt ?? undefined;

  if (!Object.values(ACCOUNT_STATES).includes(state)) {
    return [`accountState must be one of ${Object.values(ACCOUNT_STATES).join(", ")}`];
  }

  if (state !== ACCOUNT_STATES.ACTIVE && !isDate(changedAt)) {
    errors.push(`accountStateChangedAt is required when accountState is ${state}`);
  }

  if (!RESTRICTION_BEARING_STATES.has(state)) {
    if (restriction !== undefined) {
      errors.push(`accountRestriction must be absent when accountState is ${state}`);
    }
    return errors;
  }

  if (restriction === undefined) {
    errors.push(`accountRestriction is required when accountState is ${state}`);
    return errors;
  }

  const { kind, expiresAt, safeReason } = restriction;
  if (!Object.values(RESTRICTION_KINDS).includes(kind)) {
    errors.push(`accountRestriction.kind must be one of ${Object.values(RESTRICTION_KINDS).join(", ")}`);
    return errors;
  }

  if (state === ACCOUNT_STATES.MUTED && kind !== RESTRICTION_KINDS.TEMPORARY) {
    errors.push("a MUTED restriction must be TEMPORARY (mute is a temporary restriction)");
  }

  if (kind === RESTRICTION_KINDS.TEMPORARY) {
    if (!isDate(expiresAt)) {
      errors.push("a TEMPORARY restriction requires expiresAt");
    } else if (isDate(changedAt) && expiresAt.getTime() <= changedAt.getTime()) {
      errors.push("expiresAt must be after accountStateChangedAt");
    }
  } else if (expiresAt !== undefined && expiresAt !== null) {
    errors.push("an INDEFINITE restriction must not have expiresAt");
  }

  if (safeReason !== undefined && safeReason !== null) {
    if (typeof safeReason !== "string" || safeReason.trim().length === 0) {
      errors.push("safeReason, when present, must be non-empty text");
    } else if (safeReason.length > SAFE_REASON_MAX_LENGTH) {
      errors.push(`safeReason must be at most ${SAFE_REASON_MAX_LENGTH} characters`);
    }
  }

  return errors;
}
