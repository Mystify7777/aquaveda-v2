import type {
  ApplicantHistoryEntry,
  MyExpertApplicationStatus,
} from "@/lib/api/types/expert-application";

export type TimelineItem = {
  kind: "submitted" | "approved" | "rejected" | "awaiting";
  label: string;
  /** ISO timestamp of a PERSISTED event; `null` for the current state (nothing is persisted for it). */
  at: string | null;
  note?: string;
};

/**
 * Event-to-display mapping (design §5.2). Persisted history entries become
 * dated events; "Awaiting review" is the CURRENT state while pending and is
 * never given a date, because no "under review" event is persisted.
 * Re-applications appear chronologically, one "Submitted" per attempt.
 */
export function buildTimeline(
  status: MyExpertApplicationStatus,
  history: ApplicantHistoryEntry[],
): TimelineItem[] {
  const items: TimelineItem[] = history.map((entry) => {
    if (entry.toStatus === "pending") return { kind: "submitted", label: "Submitted", at: entry.timestamp };
    if (entry.toStatus === "approved") {
      return { kind: "approved", label: "Approved", at: entry.timestamp, note: entry.note };
    }
    return { kind: "rejected", label: "Not approved", at: entry.timestamp, note: entry.note };
  });
  if (status === "pending") items.push({ kind: "awaiting", label: "Awaiting review", at: null });
  return items;
}

/** The submission that belongs to the application's latest attempt (`null` = legacy, `undefined` = none). */
export function latestSubmission(history: ApplicantHistoryEntry[]) {
  const entry = [...history].reverse().find((h) => h.toStatus === "pending");
  return entry ? (entry.submission ?? null) : undefined;
}
