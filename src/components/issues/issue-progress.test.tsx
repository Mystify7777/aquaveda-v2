import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { IssueProgress } from "@/components/issues/issue-progress";
import type { IssueNextAction } from "@/lib/api/types/issue";
import { NEXT_ACTION_COPY } from "@/lib/issues/progress";
import { makeIssueDetail } from "@/test-utils/issue-detail";

afterEach(() => vi.useRealTimers());

const CASES: Array<[IssueNextAction, string, string]> = [
  ["awaiting_acknowledgement", "Awaiting acknowledgement", "An expert has not reviewed this issue yet."],
  ["awaiting_responsible_party", "Awaiting responsible party", "Waiting for someone to take responsibility for resolving it."],
  ["awaiting_start", "Awaiting start", "Someone has accepted responsibility, but work has not started yet."],
  ["work_in_progress", "Work in progress", "The responsible party is working on this issue."],
  ["awaiting_verification", "Awaiting verification", "A resolution was reported and is waiting for independent verification."],
  ["verified", "Verified", "The resolution was independently verified."],
];

const region = () => screen.getByRole("region", { name: "Progress" });

describe("IssueProgress: nextAction codes", () => {
  it.each(CASES)("%s renders its label and description", (code, label, description) => {
    render(<IssueProgress issue={makeIssueDetail({ status: "acknowledged", nextAction: code })} />);
    expect(within(region()).getByText(label)).toBeInTheDocument();
    expect(within(region()).getByText(description)).toBeInTheDocument();
    // wording only comes from the copy table
    expect(NEXT_ACTION_COPY[code].label).toBe(label);
  });

  it("only the code the API sent is shown (no other state is invented)", () => {
    render(<IssueProgress issue={makeIssueDetail({ status: "resolved", nextAction: "awaiting_verification" })} />);
    for (const [, label] of CASES.filter(([c]) => c !== "awaiting_verification")) {
      expect(within(region()).queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("a null nextAction (never for a valid issue) shows no state line rather than a guess", () => {
    render(<IssueProgress issue={makeIssueDetail({ nextAction: null })} />);
    for (const [, label] of CASES) expect(within(region()).queryByText(label)).not.toBeInTheDocument();
    expect(within(region()).getByRole("heading", { level: 2, name: "Progress" })).toBeInTheDocument();
  });
});

describe("IssueProgress: waitingSince is the backend's value, never computed", () => {
  it("shows the server's waitingSince, not createdAt, updatedAt, history or activity times", () => {
    render(
      <IssueProgress
        issue={makeIssueDetail({
          status: "acknowledged",
          nextAction: "awaiting_responsible_party",
          waitingSince: "2026-04-18T09:30:00.000Z",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-02-03T00:00:00.000Z",
          statusHistory: [{ fromStatus: null, toStatus: "open", actor: "u1", timestamp: "2026-01-05T00:00:00.000Z" }],
        })}
      />,
    );
    const since = within(region()).getByText("Since").nextElementSibling as HTMLElement;
    expect(since).toHaveTextContent("Apr 18, 2026");
    expect(within(region()).getByText("Apr 18, 2026").closest("time")).toHaveAttribute("datetime", "2026-04-18T09:30:00.000Z");
    expect(region()).not.toHaveTextContent("Jan 2, 2026");
    expect(region()).not.toHaveTextContent("Feb 3, 2026");
    expect(region()).not.toHaveTextContent("Jan 5, 2026");
  });

  it("is independent of the current time (no Date.now arithmetic)", () => {
    const issue = makeIssueDetail({ waitingSince: "2026-04-18T09:30:00.000Z" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T10:00:00Z"));
    const first = render(<IssueProgress issue={issue} />).container.innerHTML;
    vi.setSystemTime(new Date("2031-12-31T23:59:59Z"));
    const second = render(<IssueProgress issue={issue} />).container.innerHTML;
    expect(second).toBe(first);
    expect(second).not.toMatch(/ago|day|hour|minute/i);
  });

  it("an unknown or unusable waitingSince omits the row instead of inventing a date", () => {
    for (const waitingSince of [null, "not-a-date"]) {
      const { unmount } = render(<IssueProgress issue={makeIssueDetail({ waitingSince })} />);
      expect(within(region()).queryByText("Since")).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("IssueProgress: responsible party", () => {
  it("is shown exactly when the contract supplies an assignee, whatever the status (no lifecycle rule in the UI)", () => {
    const assignee = { actor: { _id: "u9", name: "Gus", role: "USER" as const }, acceptedAt: "2026-03-07T08:00:00.000Z" };
    for (const status of ["open", "acknowledged", "in_progress", "resolved", "verified"] as const) {
      const without = render(<IssueProgress issue={makeIssueDetail({ status, assignee: null })} />);
      expect(within(region()).queryByText("Responsible party"), `${status} without assignee`).not.toBeInTheDocument();
      without.unmount();
      const withIt = render(<IssueProgress issue={makeIssueDetail({ status, assignee })} />);
      expect(within(region()).getByText("Responsible party"), `${status} with assignee`).toBeInTheDocument();
      withIt.unmount();
    }
  });

  it("with no assignee (a pending offer is never public) the absence is stated by nextAction, not by a row", () => {
    render(
      <IssueProgress
        issue={makeIssueDetail({ status: "acknowledged", nextAction: "awaiting_responsible_party", assignee: null })}
      />,
    );
    expect(within(region()).getByText("Awaiting responsible party")).toBeInTheDocument();
    expect(within(region()).queryByText("Responsible party")).not.toBeInTheDocument();
    expect(region()).not.toHaveTextContent("No one has accepted");
  });

  it("names the accepted assignee with the accepted date", () => {
    render(
      <IssueProgress
        issue={makeIssueDetail({
          status: "in_progress",
          nextAction: "work_in_progress",
          assignee: { actor: { _id: "u9", name: "Gus", role: "USER" }, acceptedAt: "2026-03-07T08:00:00.000Z" },
        })}
      />,
    );
    const dd = within(region()).getByText("Responsible party").nextElementSibling as HTMLElement;
    expect(dd).toHaveTextContent("Gus");
    expect(dd).toHaveTextContent("accepted Mar 7, 2026");
    expect(region()).not.toHaveTextContent("u9"); // ids are never shown
  });

  it("an accepted assignee whose account is unavailable is stated, not invented", () => {
    render(
      <IssueProgress
        issue={makeIssueDetail({ status: "in_progress", assignee: { actor: null, acceptedAt: "2026-03-07T08:00:00.000Z" } })}
      />,
    );
    expect(within(region()).getByText(/Accepted \(account unavailable\)/)).toBeInTheDocument();
  });
});

describe("IssueProgress: resolutionDisputed is read-only", () => {
  it("false: no dispute notice at all", () => {
    render(<IssueProgress issue={makeIssueDetail({ status: "resolved", nextAction: "awaiting_verification", resolutionDisputed: false })} />);
    expect(screen.queryByText(/disputed/i)).not.toBeInTheDocument();
  });

  it("true: a clear, non-actionable notice and nothing else about the dispute", () => {
    render(<IssueProgress issue={makeIssueDetail({ status: "resolved", nextAction: "awaiting_verification", resolutionDisputed: true })} />);
    expect(within(region()).getByText("Resolution disputed")).toBeInTheDocument();
    expect(within(region()).getByText("An expert review is pending.")).toBeInTheDocument();
    // no controls, links or dispute detail
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(region()).not.toHaveTextContent(/reason|dispute[dr]? by|challenge|uphold|dismiss/i);
  });
});
