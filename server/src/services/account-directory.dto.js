import { ACCOUNT_STATES } from "../domain/account-state.js";

/**
 * Admin directory projection (#181): explicit allowlist. Raw User documents are
 * never returned. Excluded by construction: passwordHash, authGeneration,
 * accountStateVersion, bio, expertApplication, private governance reasons.
 */
export function toAdminDirectoryEntry(user, now = new Date()) {
  const r = user.accountRestriction;
  const expiresAt = r?.expiresAt ?? null;
  const deletionPending = user.accountState === ACCOUNT_STATES.DELETION_PENDING;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    registeredAt: user.createdAt.toISOString(),
    accountState: user.accountState,
    accountStateChangedAt: user.accountStateChangedAt?.toISOString() ?? null,
    deletionPending,
    deletionRequestedAt: deletionPending ? (user.accountStateChangedAt?.toISOString() ?? null) : null,
    restriction: r
      ? {
          kind: r.kind,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          safeReason: r.safeReason ?? null,
          lapsed: r.kind === "TEMPORARY" && expiresAt !== null && expiresAt <= now,
        }
      : null,
  };
}
