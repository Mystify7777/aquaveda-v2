import type { IssueStatus } from "@/lib/api/types/issue";

/** The five existing Issue lifecycle states (ADR-0003); display labels and filter parsing only. */
export const ISSUE_STATUSES: readonly IssueStatus[] = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "verified",
];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  resolved: "Resolved",
  verified: "Verified",
};

export function parseIssueStatus(raw: string | string[] | undefined): IssueStatus | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return ISSUE_STATUSES.find((s) => s === value);
}
