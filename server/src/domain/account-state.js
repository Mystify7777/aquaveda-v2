/**
 * Authoritative account lifecycle states.
 *
 * Locked by account-governance architecture (#168). Current state is
 * server-side data on User; governance history is a separate concern.
 */
export const ACCOUNT_STATES = Object.freeze({
  ACTIVE: "ACTIVE",
  MUTED: "MUTED",
  HARD_SUSPENDED: "HARD_SUSPENDED",
  DELETION_PENDING: "DELETION_PENDING",
  PERMANENTLY_DELETED: "PERMANENTLY_DELETED",
});

export const BLOCKED_ACCOUNT_STATES = Object.freeze(
  new Set([
    ACCOUNT_STATES.HARD_SUSPENDED,
    ACCOUNT_STATES.DELETION_PENDING,
    ACCOUNT_STATES.PERMANENTLY_DELETED,
  ]),
);

export function isBlockedAccountState(state) {
  return BLOCKED_ACCOUNT_STATES.has(state);
}
