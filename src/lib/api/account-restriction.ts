import { ApiError } from "./client";

/**
 * Account-governance restrictions the backend reports as `403` with a stable
 * machine-readable `code` (ADR-0010; docs/architecture/mute-enforcement.md,
 * hard-suspension.md). The backend stays the only authority: this only
 * classifies what it already decided. No restriction details (reason, expiry,
 * kind) are sent or shown (GOV-M2, GOV-S6); appeals are not built (#176).
 */
export type AccountRestriction = "muted" | "suspended";

const RESTRICTION_BY_CODE: Readonly<Record<string, AccountRestriction>> = {
  ACCOUNT_MUTED: "muted",
  ACCOUNT_SUSPENDED: "suspended",
};

/**
 * `muted` / `suspended` only for an API answer of HTTP 403 whose `code` is
 * exactly the backend code. A generic 403, other statuses, transport errors
 * and non-ApiErrors all return `null` and keep their existing handling.
 */
export function getAccountRestriction(error: unknown): AccountRestriction | null {
  if (!(error instanceof ApiError) || error.kind !== "http" || error.status !== 403) return null;
  const code = error.code;
  return code !== undefined && Object.hasOwn(RESTRICTION_BY_CODE, code) ? RESTRICTION_BY_CODE[code] : null;
}

export const RESTRICTION_NOTICE: Readonly<Record<AccountRestriction, { title: string; message: string }>> = {
  muted: {
    title: "Your account is muted",
    message:
      "You can still read and browse AquaVeda, but posting, reporting and other contributions are paused on your account for now.",
  },
  suspended: {
    title: "Your account is suspended",
    message:
      "Signed-in features are unavailable while your account is suspended. Sign out to keep browsing AquaVeda's public pages.",
  },
};

const ACTION_MESSAGE: Readonly<Record<AccountRestriction, string>> = {
  muted: "Your account is muted, so this action isn't available right now. You can still read and browse.",
  suspended: "Your account is suspended, so this action isn't available. Sign out to keep browsing public pages.",
};

/** One-line copy for a failed write, or `null` when the error is not a restriction. */
export function restrictedActionMessage(error: unknown): string | null {
  const restriction = getAccountRestriction(error);
  return restriction ? ACTION_MESSAGE[restriction] : null;
}
