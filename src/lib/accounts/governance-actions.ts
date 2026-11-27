import type { AdminAccountEntry } from "@/lib/api/types/accounts";
import type { LiftInput, MuteInput, SuspendInput } from "@/lib/api/account-governance";
import { getAccountRestriction, restrictedActionMessage } from "@/lib/api/account-restriction";
import { ApiError } from "@/lib/api/client";

import { REASON_MAX_LENGTH, SAFE_REASON_MAX_LENGTH } from "./governance-contract";

/**
 * Presentation logic for the Admin governance mutation UI (#264). Pure.
 *
 * This decides what is WORTH OFFERING, never what is permitted: the backend is
 * the only authority (ADR-0012 target rules, state preconditions, atomic
 * writes). There is no server-provided capability list for account governance,
 * so availability follows the persisted account state (what the backend's state
 * preconditions check) plus ADR-0012's "no controls for Admins or yourself".
 */
export type GovernanceAction = "mute" | "suspend" | "liftMute" | "liftSuspension";

/** Why an account has no controls, for the existing operator-managed note. */
export function governanceProtection(
  entry: Pick<AdminAccountEntry, "id" | "role">,
  viewerId: string | undefined,
): "admin" | "self" | null {
  if (entry.role === "ADMIN") return "admin";
  if (viewerId !== undefined && entry.id === viewerId) return "self";
  return null;
}

/**
 * Positive allowlist: only USER and EXPERT targets other than the viewer, and only
 * the actions that match the persisted state (the backend requires ACTIVE to mute
 * or suspend, MUTED to lift a mute, HARD_SUSPENDED to lift a suspension). A lapsed
 * restriction is still its persisted state until lifted, so its lift stays offered.
 */
export function availableGovernanceActions(
  entry: Pick<AdminAccountEntry, "id" | "role" | "accountState">,
  viewerId: string | undefined,
): GovernanceAction[] {
  if (viewerId === undefined) return [];
  if (entry.role !== "USER" && entry.role !== "EXPERT") return [];
  if (governanceProtection(entry, viewerId)) return [];
  switch (entry.accountState) {
    case "ACTIVE":
      return ["mute", "suspend"];
    case "MUTED":
      return ["liftMute"];
    case "HARD_SUSPENDED":
      return ["liftSuspension"];
    default:
      return [];
  }
}

export const ACTION_LABEL: Readonly<Record<GovernanceAction, string>> = {
  mute: "Mute",
  suspend: "Suspend",
  liftMute: "Lift mute",
  liftSuspension: "Lift suspension",
};

// ---- Durations -------------------------------------------------------------

const HOUR = 3_600_000;
export const DURATION_PRESETS = [
  { id: "1h", label: "1 hour", ms: HOUR },
  { id: "24h", label: "24 hours", ms: 24 * HOUR },
  { id: "7d", label: "7 days", ms: 7 * 24 * HOUR },
  { id: "30d", label: "30 days", ms: 30 * 24 * HOUR },
] as const;

export type DurationChoice = (typeof DURATION_PRESETS)[number]["id"] | "custom";

/** The expiry is computed at SUBMIT time, so a dialog left open never sends a stale instant. */
export function resolveExpiry(
  choice: DurationChoice,
  custom: string,
  now: Date,
): { ok: true; expiresAt: string } | { ok: false; message: string } {
  if (choice !== "custom") {
    const preset = DURATION_PRESETS.find((p) => p.id === choice);
    return preset
      ? { ok: true, expiresAt: new Date(now.getTime() + preset.ms).toISOString() }
      : { ok: false, message: "Choose how long this lasts." };
  }
  if (!custom) return { ok: false, message: "Choose an end date and time." };
  const at = new Date(custom); // a datetime-local value, in the admin's local time zone
  if (Number.isNaN(at.getTime())) return { ok: false, message: "Enter a valid end date and time." };
  if (at.getTime() <= now.getTime()) return { ok: false, message: "The end must be in the future." };
  return { ok: true, expiresAt: at.toISOString() };
}

// ---- Form validation (the server stays authoritative) ----------------------

export interface GovernanceFields {
  duration: DurationChoice;
  customEnd: string;
  suspendKind: "TEMPORARY" | "INDEFINITE";
  reason: string;
  safeReason: string;
}

export const EMPTY_FIELDS: GovernanceFields = {
  duration: "24h",
  customEnd: "",
  suspendKind: "INDEFINITE",
  reason: "",
  safeReason: "",
};

export type FieldErrors = Partial<Record<"duration" | "reason" | "safeReason", string>>;

export type GovernanceRequest =
  | { action: "mute"; input: MuteInput }
  | { action: "suspend"; input: SuspendInput }
  | { action: "liftMute"; input: LiftInput }
  | { action: "liftSuspension"; input: LiftInput };

export type ValidationResult = { ok: true; request: GovernanceRequest } | { ok: false; errors: FieldErrors };

export function validateGovernanceForm(action: GovernanceAction, fields: GovernanceFields, now: Date): ValidationResult {
  const errors: FieldErrors = {};
  const reason = fields.reason.trim();
  const safeReason = fields.safeReason.trim();

  if (reason.length > REASON_MAX_LENGTH) errors.reason = `The reason can be at most ${REASON_MAX_LENGTH} characters.`;
  if (safeReason.length > SAFE_REASON_MAX_LENGTH)
    errors.safeReason = `The message can be at most ${SAFE_REASON_MAX_LENGTH} characters.`;

  const needsReason = action === "suspend"; // the backend requires it for a suspension only
  if (needsReason && !reason) errors.reason = "A private reason is required for a suspension.";

  let expiresAt: string | undefined;
  const needsExpiry = action === "mute" || (action === "suspend" && fields.suspendKind === "TEMPORARY");
  if (needsExpiry) {
    const expiry = resolveExpiry(fields.duration, fields.customEnd, now);
    if (expiry.ok) expiresAt = expiry.expiresAt;
    else errors.duration = expiry.message;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const optionalReason = reason ? { reason } : {};
  const optionalSafe = safeReason ? { safeReason } : {};
  switch (action) {
    case "mute":
      return { ok: true, request: { action, input: { expiresAt: expiresAt!, ...optionalReason, ...optionalSafe } } };
    case "suspend":
      return {
        ok: true,
        request: {
          action,
          input:
            fields.suspendKind === "TEMPORARY"
              ? { kind: "TEMPORARY", expiresAt: expiresAt!, reason, ...optionalSafe }
              : { kind: "INDEFINITE", reason, ...optionalSafe },
        },
      };
    default:
      return { ok: true, request: { action, input: { ...optionalReason } } };
  }
}

// ---- Failure classification ------------------------------------------------

export type FailureKind =
  | "validation"
  | "protected"
  | "stale"
  | "not-found"
  | "session"
  | "restricted"
  | "forbidden"
  | "unknown-outcome"
  | "failed";

export interface GovernanceFailure {
  kind: FailureKind;
  message: string;
  /** Re-read the account and its history so the UI converges with the server. NEVER re-send the mutation. */
  reconcile: boolean;
  /** The dialog cannot usefully stay open (its premise changed). */
  closesDialog: boolean;
}

const failure = (kind: FailureKind, message: string, reconcile: boolean, closesDialog: boolean): GovernanceFailure => ({
  kind,
  message,
  reconcile,
  closesDialog,
});

/**
 * Map an API failure to safe, actionable copy. Server `reason`s for the ADR-0012
 * target rules are authoritative and merely presented. Nothing from the error body
 * other than the backend's own field-validation text (VALIDATION_FAILED) is shown.
 */
export function classifyGovernanceFailure(error: unknown): GovernanceFailure {
  if (!(error instanceof ApiError)) return failure("failed", "That action could not be completed. Try again.", false, false);

  const restricted = restrictedActionMessage(error);
  if (restricted && getAccountRestriction(error)) return failure("restricted", restricted, false, false);

  if (error.kind === "network" || error.kind === "response") {
    return failure(
      "unknown-outcome",
      "We couldn't confirm whether the change was applied. The account was reloaded below; check its state before trying again.",
      true,
      true,
    );
  }
  const status = error.status;
  if (status === 401) return failure("session", "Your session is no longer valid. Sign in again to continue.", false, false);
  if (status === 400 && error.code === "VALIDATION_FAILED") {
    // The server's field-validation text is safe to show (it names fields, never data), but can be terse ("Required").
    return failure(
      "validation",
      error.message ? `Check the details and try again. The server said: "${error.message}".` : "Check the details and try again.",
      false,
      false,
    );
  }
  if (status === 403) {
    if (error.serverReason === "SELF_TARGET_PROHIBITED") {
      return failure("protected", "You can't change your own account's governance state.", true, true);
    }
    if (error.serverReason === "ADMIN_TARGET_PROTECTED") {
      return failure("protected", "Administrator accounts are managed by operators and can't be changed here.", true, true);
    }
    return failure("forbidden", "Your account is not permitted to change this account.", false, false);
  }
  if (status === 404) return failure("not-found", "This account no longer exists.", true, true);
  if (status === 409 && (error.code === "STATE_RACE" || error.code === "INVALID_STATE")) {
    return failure(
      "stale",
      "This account changed while you were working, so nothing was applied. The latest state is shown below; review it and choose an action again.",
      true,
      true,
    );
  }
  if (status !== undefined && status >= 500) {
    // The state may have changed before a later step failed (the audit event is a second write): reconcile.
    return failure(
      "unknown-outcome",
      "We couldn't confirm whether the change was applied. The account was reloaded below; check its state before trying again.",
      true,
      true,
    );
  }
  return failure("failed", "That action could not be completed. Try again.", false, false);
}

export const SUCCESS_MESSAGE: Readonly<Record<GovernanceAction, (name: string) => string>> = {
  mute: (name) => `${name} was muted.`,
  suspend: (name) => `${name} was suspended.`,
  liftMute: (name) => `The mute on ${name} was lifted.`,
  liftSuspension: (name) => `The suspension on ${name} was lifted.`,
};
