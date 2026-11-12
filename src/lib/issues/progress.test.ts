import { describe, it, expect } from "vitest";

import type { IssueActivityEntry, IssueActivityType, IssueNextAction } from "@/lib/api/types/issue";
import { NEXT_ACTION_COPY, describeActivity } from "@/lib/issues/progress";

const CODES: IssueNextAction[] = [
  "awaiting_acknowledgement",
  "awaiting_responsible_party",
  "awaiting_start",
  "work_in_progress",
  "awaiting_verification",
  "verified",
];

const entry = (over: Partial<IssueActivityEntry>): IssueActivityEntry => ({
  id: "h:0",
  type: "status_changed",
  timestamp: "2026-03-05T10:00:00.000Z",
  actor: null,
  note: null,
  ...over,
});

describe("NEXT_ACTION_COPY", () => {
  it("has wording for exactly the six backend codes, and nothing else", () => {
    expect(Object.keys(NEXT_ACTION_COPY).sort()).toEqual([...CODES].sort());
  });

  it("every code has a distinct, non-empty label and a description", () => {
    const labels = CODES.map((c) => NEXT_ACTION_COPY[c].label);
    expect(new Set(labels).size).toBe(CODES.length);
    for (const code of CODES) {
      expect(NEXT_ACTION_COPY[code].label.length).toBeGreaterThan(0);
      expect(NEXT_ACTION_COPY[code].description.length).toBeGreaterThan(0);
    }
  });

  it("uses the user-facing names from ADR-0008", () => {
    expect(CODES.map((c) => NEXT_ACTION_COPY[c].label)).toEqual([
      "Awaiting acknowledgement",
      "Awaiting responsible party",
      "Awaiting start",
      "Work in progress",
      "Awaiting verification",
      "Verified",
    ]);
  });
});

describe("describeActivity", () => {
  it("separates lifecycle (status) events from responsibility events", () => {
    expect(describeActivity(entry({ type: "report_submitted" }))).toEqual({ kind: "status", title: "Issue reported" });
    expect(describeActivity(entry({ fromStatus: "open", toStatus: "acknowledged" }))).toEqual({
      kind: "status",
      title: "Open → Acknowledged",
    });
    const titles: Record<Exclude<IssueActivityType, "report_submitted" | "status_changed">, string> = {
      responsibility_offered: "Responsibility offered",
      responsibility_accepted: "Responsibility accepted",
      responsibility_declined: "Responsibility offer declined",
      responsibility_released: "Responsibility released",
      responsibility_withdrawn: "Responsibility offer withdrawn",
      responsibility_revoked: "Responsibility revoked",
    };
    for (const [type, title] of Object.entries(titles)) {
      expect(describeActivity(entry({ type: type as IssueActivityType }))).toEqual({ kind: "responsibility", title });
    }
  });

  it("a status change with an incomplete transition still reads honestly", () => {
    expect(describeActivity(entry({ toStatus: "resolved" }))).toEqual({ kind: "status", title: "Status: Resolved" });
    expect(describeActivity(entry({}))).toEqual({ kind: "status", title: "Status changed" });
  });

  it("an unknown future event type degrades to a neutral responsibility line, not an exception", () => {
    expect(describeActivity(entry({ type: "something_new" as IssueActivityType }))).toEqual({
      kind: "responsibility",
      title: "Responsibility update",
    });
  });
});
