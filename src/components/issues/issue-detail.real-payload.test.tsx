import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { IssueDetail } from "@/components/issues/issue-detail";
import type { IssueActivityType, IssueDetailData, IssueNextAction } from "@/lib/api/types/issue";
import { ISSUE_STATUSES } from "@/lib/issues/status";
import realPayload from "@/test-utils/fixtures/issue-detail.resolved.json";

vi.mock("@/components/issues/issue-map-loader", () => ({
  IssueMapLoader: ({ label }: { label: string }) => <div role="region" aria-label={label} />,
}));

/**
 * The UI against a payload RECORDED FROM THE REAL BACKEND (`GET /api/v1/issues/:id`
 * for a resolved issue with a granted and accepted responsibility), not a
 * hand-written one.
 *
 * What this does and does not guarantee: a JSON import widens string literals,
 * so TypeScript cannot check the file against `IssueDetailData` directly. The
 * payload is therefore (1) validated at RUNTIME below (enums, required keys,
 * value shapes), and (2) the enumerations it is validated against are bound at
 * COMPILE time to the frontend unions (`satisfies Record<Union, true>`), so
 * adding or removing a union member forces this test to be revisited. It is
 * not a generated schema check; regenerate the fixture by dumping that
 * response from the server's lifecycle test fixtures.
 */
const issue = realPayload as unknown as IssueDetailData;

const KNOWN_ACTIVITY_TYPES = {
  report_submitted: true,
  status_changed: true,
  responsibility_offered: true,
  responsibility_accepted: true,
  responsibility_declined: true,
  responsibility_released: true,
  responsibility_withdrawn: true,
  responsibility_revoked: true,
} satisfies Record<IssueActivityType, true>;

const KNOWN_NEXT_ACTIONS = {
  awaiting_acknowledgement: true,
  awaiting_responsible_party: true,
  awaiting_start: true,
  work_in_progress: true,
  awaiting_verification: true,
  verified: true,
} satisfies Record<IssueNextAction, true>;

const isoDate = (v: unknown) => typeof v === "string" && !Number.isNaN(new Date(v).getTime());
const isActor = (a: unknown) => {
  const x = a as Record<string, unknown> | null;
  return !!x && typeof x._id === "string" && typeof x.name === "string" && typeof x.role === "string";
};

describe("IssueDetail with a recorded real API payload", () => {
  it("has exactly the contract keys the frontend type declares", () => {
    expect(Object.keys(issue).sort()).toEqual(
      [
        "_id", "activity", "assignee", "category", "createdAt", "description", "domain", "location",
        "nextAction", "reportedBy", "resolutionDisputed", "severity", "status", "statusHistory", "title",
        "updatedAt", "waitingSince",
      ].sort(),
    );
    for (const e of issue.activity) {
      expect(Object.keys(e)).toEqual(expect.arrayContaining(["id", "type", "timestamp", "actor", "note"]));
    }
  });

  it("conforms to the frontend types at runtime: enums, required keys and value shapes", () => {
    expect(ISSUE_STATUSES).toContain(issue.status);
    expect(Object.keys(KNOWN_NEXT_ACTIONS)).toContain(issue.nextAction);
    expect(isoDate(issue.waitingSince)).toBe(true);
    expect(typeof issue.resolutionDisputed).toBe("boolean");
    expect(isActor(issue.reportedBy)).toBe(true);
    expect(issue.assignee === null || (isActor(issue.assignee.actor) && isoDate(issue.assignee.acceptedAt))).toBe(true);
    expect(Array.isArray(issue.activity)).toBe(true);
    for (const e of issue.activity) {
      expect(typeof e.id, e.id).toBe("string");
      expect(Object.keys(KNOWN_ACTIVITY_TYPES), `${e.id} type ${e.type}`).toContain(e.type);
      expect(isoDate(e.timestamp), e.id).toBe(true);
      expect(e.actor === null || isActor(e.actor), e.id).toBe(true);
      expect(e.note === null || typeof e.note === "string", e.id).toBe(true);
      if (e.type === "status_changed") {
        expect(ISSUE_STATUSES, e.id).toContain(e.toStatus);
        expect(e.fromStatus === null || ISSUE_STATUSES.includes(e.fromStatus as never), e.id).toBe(true);
      }
    }
  });

  it("renders Progress from the server's derived fields", () => {
    render(<IssueDetail issue={issue} />);
    const progress = screen.getByRole("region", { name: "Progress" });
    expect(progress).toHaveTextContent("Awaiting verification");
    expect(progress).toHaveTextContent("Responsible party");
    expect(progress).toHaveTextContent("accepted");
    expect(progress).not.toHaveTextContent(/disputed/i);
  });

  it("renders the Timeline in the server's order, mixing status and responsibility events", () => {
    render(<IssueDetail issue={issue} />);
    const items = within(screen.getByRole("region", { name: "Timeline" })).getAllByRole("listitem");
    expect(items).toHaveLength(issue.activity.length);
    const kinds = items.map((li) => li.querySelector("p")?.textContent);
    expect(kinds).toEqual(issue.activity.map((e) => (e.type.startsWith("responsibility_") ? "Responsibility" : "Status")));
    expect(items[0]).toHaveTextContent("Issue reported");
    // the pending offer shows no actor; the acceptance names the responsible party
    const offered = items[issue.activity.findIndex((e) => e.type === "responsibility_offered")];
    expect(offered).not.toHaveTextContent("by ");
    // the resolution note is public text
    expect(screen.getByRole("region", { name: "Timeline" })).toHaveTextContent("Replaced the cracked section.");
  });

  it("renders no controls other than Copy ID", () => {
    render(<IssueDetail issue={issue} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Copy ID"]);
  });
});
