import { restrictedActionMessage } from "@/lib/api/account-restriction";
import { ApiError } from "@/lib/api/client";

/**
 * Descriptive registry: HOW to render/execute a known server capability.
 * It never decides WHETHER a viewer may act — that is `workflow.actions` (ADR-0008 §11).
 */
export const WORKFLOW_ACTIONS = [
  "acknowledge",
  "remediation.grant",
  "remediation.withdraw",
  "remediation.revoke",
  "remediation.accept",
  "remediation.decline",
  "remediation.release",
  "remediation.start",
  "remediation.resolve",
  "resolution.verify",
  "resolution.fail",
] as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export interface ActionSpec {
  label: string;
  confirmLabel: string;
  /** Path suffix under /issues/:issueId */
  path: string;
  note: "none" | "optional" | "required";
  noteLabel?: string;
  noteMinLength?: number;
  consequence?: string;
  grantee?: boolean;
  destructive?: boolean;
}

export const ACTION_SPECS: Record<WorkflowAction, ActionSpec> = {
  acknowledge: { label: "Acknowledge", confirmLabel: "Confirm acknowledge", path: "acknowledge", note: "optional" },
  "remediation.grant": { label: "Grant remediation", confirmLabel: "Confirm grant", path: "remediation/grant", note: "optional", grantee: true },
  "remediation.withdraw": { label: "Withdraw grant", confirmLabel: "Confirm withdraw", path: "remediation/withdraw", note: "required", noteLabel: "Reason for withdrawing", destructive: true },
  "remediation.revoke": { label: "Revoke grant", confirmLabel: "Confirm revoke", path: "remediation/revoke", note: "required", noteLabel: "Reason for revoking", destructive: true },
  "remediation.accept": { label: "Accept remediation", confirmLabel: "Accept remediation", path: "remediation/accept", note: "none" },
  "remediation.decline": { label: "Decline remediation", confirmLabel: "Confirm decline", path: "remediation/decline", note: "optional", destructive: true },
  "remediation.release": { label: "Release remediation", confirmLabel: "Confirm release", path: "remediation/release", note: "optional", destructive: true },
  "remediation.start": { label: "Start remediation", confirmLabel: "Confirm start", path: "start", note: "optional" },
  "remediation.resolve": { label: "Mark resolved", confirmLabel: "Confirm resolution", path: "resolve", note: "required", noteLabel: "Resolution note" },
  "resolution.verify": { label: "Verify resolution", confirmLabel: "Confirm verification", path: "verify", note: "required", noteLabel: "Verification rationale" },
  "resolution.fail": {
    label: "Request changes",
    confirmLabel: "Request changes",
    path: "fail-verification",
    note: "required",
    noteLabel: "Reason for requesting changes",
    noteMinLength: 10,
    consequence: "The resolution will be sent back for further work and the current resolution will not be verified.",
  },
};

export function isKnownAction(action: string): action is WorkflowAction {
  return Object.prototype.hasOwnProperty.call(ACTION_SPECS, action);
}

export interface ActionInput {
  note: string;
  granteeId: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

export function validateActionInput(
  action: WorkflowAction,
  input: ActionInput,
): { note?: string; granteeId?: string } {
  const spec = ACTION_SPECS[action];
  const errors: { note?: string; granteeId?: string } = {};
  if (spec.grantee && !OBJECT_ID.test(input.granteeId.trim())) {
    errors.granteeId = "Enter a valid user ID (24 hexadecimal characters).";
  }
  if (spec.note === "required") {
    const note = input.note.trim();
    if (!note) {
      errors.note = "A note is required.";
    } else if (spec.noteMinLength && note.length < spec.noteMinLength) {
      errors.note = `Use at least ${spec.noteMinLength} characters to explain the reason.`;
    }
  }
  return errors;
}

export function buildActionBody(action: WorkflowAction, input: ActionInput): Record<string, string> {
  const spec = ACTION_SPECS[action];
  const body: Record<string, string> = {};
  if (spec.grantee) body.granteeId = input.granteeId.trim();
  if (spec.note !== "none") {
    const note = input.note.trim();
    if (note) body.note = note;
  }
  return body;
}

export interface ActionFailure {
  message: string;
  /** Re-read /workflow: capability state may have changed. */
  reload: boolean;
  /** Public Issue DTO may be stale. */
  refresh: boolean;
  signIn: boolean;
}

const base = { reload: false, refresh: false, signIn: false };

/** Stable user-facing copy; raw backend messages are never surfaced. */
export function describeActionFailure(error: unknown): ActionFailure {
  if (error instanceof ApiError) {
    if (error.kind === "network") {
      return { ...base, message: "Couldn't reach the server. Check your connection and try again." };
    }
    if (error.status === 401 || error.code === "UNAUTHORIZED") {
      return { ...base, signIn: true, message: "Your session has expired. Sign in to continue." };
    }
    const restricted = restrictedActionMessage(error);
    if (restricted) return { ...base, message: restricted };
    if (error.status === 403 || error.code === "FORBIDDEN") {
      return { ...base, reload: true, message: "You no longer have permission to perform this action." };
    }
    if (error.status === 409 || error.code === "INVALID_STATE" || error.code === "STATE_RACE") {
      return { ...base, reload: true, refresh: true, message: "This issue changed before your action completed. Showing the latest available actions." };
    }
    if (error.status === 404 || error.code === "NOT_FOUND") {
      return { ...base, refresh: true, message: "This issue is no longer available." };
    }
    if (error.status === 400 || error.status === 422 || error.code === "VALIDATION_FAILED") {
      return { ...base, message: "The server rejected the input. Review the fields and try again." };
    }
  }
  return { ...base, message: "Something went wrong. Try again." };
}
