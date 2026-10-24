import type { ExpertSubmission, ReviewerHistoryEntry } from "@/lib/api/types/expert-application";

export type PreviousAttempt = {
  submittedAt: string;
  /** `null` = legacy attempt submitted before details were collected. */
  submission: ExpertSubmission | null;
  outcome?: { toStatus: "approved" | "rejected"; at: string; note?: string };
};

/**
 * Earlier attempts of a re-application (everything before the CURRENT pending
 * entry), each with the decision that followed it. The current attempt is the
 * last `-> pending` entry and is excluded: the reviewer's detail view shows it
 * as the application under review.
 */
export function previousAttempts(history: ReviewerHistoryEntry[]): PreviousAttempt[] {
  const pendingIdx = history.flatMap((h, i) => (h.toStatus === "pending" ? [i] : []));
  const earlier = pendingIdx.slice(0, -1);
  return earlier.map((i) => {
    const next = history[i + 1];
    return {
      submittedAt: history[i].timestamp,
      submission: history[i].submission ?? null,
      outcome:
        next && next.toStatus !== "pending"
          ? { toStatus: next.toStatus, at: next.timestamp, note: next.note }
          : undefined,
    };
  });
}
