import type { IssueActivityEntry, IssueActivityType, IssueNextAction } from "@/lib/api/types/issue";
import { ISSUE_STATUS_LABELS } from "@/lib/issues/status";

/**
 * Presentation copy for the progression read model (#148 / ADR-0008 section 6).
 * PURE WORDING: the backend owns every derivation (`nextAction`, `waitingSince`,
 * `resolutionDisputed`); nothing here computes state, time or authority.
 */

export const NEXT_ACTION_COPY: Record<IssueNextAction, { label: string; description: string }> = {
  awaiting_acknowledgement: {
    label: "Awaiting acknowledgement",
    description: "An expert has not reviewed this issue yet.",
  },
  awaiting_responsible_party: {
    label: "Awaiting responsible party",
    description: "Waiting for someone to take responsibility for resolving it.",
  },
  awaiting_start: {
    label: "Awaiting start",
    description: "Someone has accepted responsibility, but work has not started yet.",
  },
  work_in_progress: {
    label: "Work in progress",
    description: "The responsible party is working on this issue.",
  },
  awaiting_verification: {
    label: "Awaiting verification",
    description: "A resolution was reported and is waiting for independent verification.",
  },
  verified: {
    label: "Verified",
    description: "The resolution was independently verified.",
  },
};

export type ActivityKind = "status" | "responsibility";

const RESPONSIBILITY_TITLES: Record<Exclude<IssueActivityType, "report_submitted" | "status_changed">, string> = {
  responsibility_offered: "Responsibility offered",
  responsibility_accepted: "Responsibility accepted",
  responsibility_declined: "Responsibility offer declined",
  responsibility_released: "Responsibility released",
  responsibility_withdrawn: "Responsibility offer withdrawn",
  responsibility_revoked: "Responsibility revoked",
};

/**
 * How one server-provided activity entry reads. The `kind` separates lifecycle
 * (status) events from responsibility (remediation) events with a text label,
 * not color. Unknown future event types degrade to a neutral, honest line
 * instead of being dropped or guessed at.
 */
export function describeActivity(entry: IssueActivityEntry): { kind: ActivityKind; title: string } {
  if (entry.type === "report_submitted") return { kind: "status", title: "Issue reported" };
  if (entry.type === "status_changed") {
    const to = entry.toStatus ? ISSUE_STATUS_LABELS[entry.toStatus] : null;
    const from = entry.fromStatus ? ISSUE_STATUS_LABELS[entry.fromStatus] : null;
    if (from && to) return { kind: "status", title: `${from} → ${to}` };
    return { kind: "status", title: to ? `Status: ${to}` : "Status changed" };
  }
  const title = (RESPONSIBILITY_TITLES as Record<string, string | undefined>)[entry.type];
  return { kind: "responsibility", title: title ?? "Responsibility update" };
}
