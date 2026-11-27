import { apiRequest } from "./client";
import { buildApiUrl } from "./config";

/**
 * Admin account-governance MUTATION calls (#264). Deliberately a separate module
 * from `accounts.ts`, whose read-only boundary (#250) is pinned by a test. The
 * backend is the only authority: it enforces ADMIN, the ADR-0012 target rules
 * (self / any Admin), state preconditions and the atomic write. These are thin
 * calls; nothing here decides whether an operation is permitted.
 *
 * No client idempotency key exists on the API (the server derives one from the
 * account's state version), so a call whose outcome is unknown (network error,
 * timeout, 5xx) must be reconciled by re-reading the account, never re-sent.
 */
const base = "/api/v1/accounts";
const JSON_HEADERS = { "Content-Type": "application/json" };

export interface MuteInput {
  /** ISO 8601, in the future (the server re-checks). */
  expiresAt: string;
  /** Private enforcement reason (optional). Never displayed back. */
  reason?: string;
  /** User-facing explanation (optional). */
  safeReason?: string;
}

export type SuspendInput =
  | { kind: "TEMPORARY"; expiresAt: string; reason: string; safeReason?: string }
  | { kind: "INDEFINITE"; reason: string; safeReason?: string };

export interface LiftInput {
  reason?: string;
}

/** Only what the UI needs; the UI reconciles by re-reading the account, not from this. */
export interface GovernanceMutationResult {
  id: string;
  accountState: string;
}

function post<T extends object>(userId: string, path: string, body: T, signal?: AbortSignal) {
  return apiRequest<GovernanceMutationResult>(buildApiUrl(`${base}/${encodeURIComponent(userId)}/${path}`), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal,
  });
}

export const muteAccount = (userId: string, input: MuteInput) => post(userId, "mute", input);
export const liftMute = (userId: string, input: LiftInput = {}) => post(userId, "mute/lift", input);
export const suspendAccount = (userId: string, input: SuspendInput) => post(userId, "suspend", input);
export const liftSuspension = (userId: string, input: LiftInput = {}) => post(userId, "suspend/lift", input);
