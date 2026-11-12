import { ISSUE_CATEGORIES, ISSUE_SEVERITIES } from "@/lib/issues/classification";
import type { IssueActivityEntry, IssueDetailData } from "@/lib/api/types/issue";

/**
 * Builder for the public Issue DETAIL read (#142 activity, #148 progress).
 * Defaults describe a freshly reported, open issue. Ids follow the backend
 * (`h:<i>` history entries, `r:<i>` remediation events).
 */
export const T0 = "2026-03-05T10:00:00.000Z";

export function reportedEntry(over: Partial<IssueActivityEntry> = {}): IssueActivityEntry {
  return {
    id: "h:0",
    type: "report_submitted",
    timestamp: T0,
    actor: { _id: "u1", name: "Asha", role: "USER" },
    note: null,
    // The real `report_submitted` entry carries no from/to status (verified against the API).
    ...over,
  };
}

export function makeIssueDetail(over: Partial<IssueDetailData> = {}): IssueDetailData {
  return {
    _id: "i1",
    title: "Burst pipe",
    description: "Line one\nLine two",
    location: { type: "Point", coordinates: [77.5, 12.9] },
    severity: ISSUE_SEVERITIES[0].value,
    category: ISSUE_CATEGORIES[0].value,
    domain: "water",
    status: "open",
    reportedBy: { _id: "u1", name: "Asha", role: "USER" },
    statusHistory: [{ fromStatus: null, toStatus: "open", actor: "u1", timestamp: T0 }],
    createdAt: T0,
    updatedAt: T0,
    assignee: null,
    activity: [reportedEntry()],
    nextAction: "awaiting_acknowledgement",
    waitingSince: T0,
    resolutionDisputed: false,
    ...over,
  };
}
