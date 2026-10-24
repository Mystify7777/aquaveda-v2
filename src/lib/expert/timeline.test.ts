import { describe, it, expect } from "vitest";

import type { ApplicantHistoryEntry, ReviewerHistoryEntry } from "@/lib/api/types/expert-application";
import { previousAttempts } from "@/lib/expert/attempts";
import { buildTimeline, latestSubmission } from "@/lib/expert/timeline";

const sub = (tag: string) => ({ expertiseAreas: ["other"], experience: tag.repeat(80), references: [] });
const e = (toStatus: ApplicantHistoryEntry["toStatus"], at: string, extra: Partial<ApplicantHistoryEntry> = {}): ApplicantHistoryEntry => ({
  fromStatus: toStatus === "pending" ? null : "pending",
  toStatus,
  timestamp: at,
  ...extra,
});

describe("buildTimeline (design §5.2)", () => {
  it("pending: Submitted (dated) then Awaiting review as the CURRENT state with no date", () => {
    const t = buildTimeline("pending", [e("pending", "2026-03-05T10:00:00.000Z", { submission: sub("a") })]);
    expect(t.map((i) => i.label)).toEqual(["Submitted", "Awaiting review"]);
    expect(t[0].at).toBe("2026-03-05T10:00:00.000Z");
    expect(t[1].at).toBeNull();
  });

  it("never invents an 'Under review' event", () => {
    const t = buildTimeline("pending", [e("pending", "2026-03-05T10:00:00.000Z")]);
    expect(t.some((i) => /under review/i.test(i.label))).toBe(false);
  });

  it("rejected then re-applied: chronological, one Submitted per attempt, note kept on the decision", () => {
    const t = buildTimeline("pending", [
      e("pending", "2026-03-05T10:00:00.000Z"),
      e("rejected", "2026-03-06T10:00:00.000Z", { note: "add detail" }),
      e("pending", "2026-03-07T10:00:00.000Z"),
    ]);
    expect(t.map((i) => i.label)).toEqual(["Submitted", "Not approved", "Submitted", "Awaiting review"]);
    expect(t[1].note).toBe("add detail");
  });

  it("approved and none", () => {
    expect(buildTimeline("approved", [e("pending", "2026-03-05T10:00:00.000Z"), e("approved", "2026-03-06T10:00:00.000Z", { note: "Welcome" })]).map((i) => i.label)).toEqual(["Submitted", "Approved"]);
    expect(buildTimeline("none", [])).toEqual([]);
  });
});

describe("latestSubmission", () => {
  it("returns the latest pending entry's submission, null for legacy, undefined when there is none", () => {
    expect(latestSubmission([e("pending", "t1", { submission: sub("a") }), e("rejected", "t2"), e("pending", "t3", { submission: sub("b") })])?.experience).toBe("b".repeat(80));
    expect(latestSubmission([e("pending", "t1", { submission: null })])).toBeNull();
    expect(latestSubmission([e("pending", "t1")])).toBeNull();
    expect(latestSubmission([])).toBeUndefined();
  });
});

describe("previousAttempts (reviewer detail)", () => {
  const r = (toStatus: ReviewerHistoryEntry["toStatus"], at: string, extra: Partial<ReviewerHistoryEntry> = {}): ReviewerHistoryEntry => ({
    ...e(toStatus, at, extra),
    actor: "a1",
  });

  it("is empty for a first application", () => {
    expect(previousAttempts([r("pending", "t1", { submission: sub("a") })])).toEqual([]);
  });

  it("returns earlier attempts with their outcome and excludes the current one", () => {
    const attempts = previousAttempts([
      r("pending", "t1", { submission: sub("a") }),
      r("rejected", "t2", { note: "needs references" }),
      r("pending", "t3", { submission: sub("b") }),
    ]);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ submittedAt: "t1", outcome: { toStatus: "rejected", at: "t2", note: "needs references" } });
    expect(attempts[0].submission?.experience).toBe("a".repeat(80));
  });

  it("a legacy earlier attempt has a null submission", () => {
    const attempts = previousAttempts([r("pending", "t1"), r("rejected", "t2", { note: "n" }), r("pending", "t3", { submission: sub("b") })]);
    expect(attempts[0].submission).toBeNull();
  });
});
