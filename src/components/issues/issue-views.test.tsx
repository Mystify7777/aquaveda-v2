import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { IssueCard } from "@/components/issues/issue-card";
import { IssueDetail } from "@/components/issues/issue-detail";
import { IssueStatusFilter } from "@/components/issues/issue-status-filter";
import { ISSUE_CATEGORIES, ISSUE_SEVERITIES } from "@/lib/issues/classification";
import type { Issue } from "@/lib/api/types/issue";

vi.mock("@/components/issues/issue-map-loader", () => ({
  IssueMapLoader: ({ label }: { label: string }) => <div role="region" aria-label={label} />,
}));

export function makeIssue(over: Partial<Issue> = {}): Issue {
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
    statusHistory: [{ fromStatus: null, toStatus: "open", actor: "u1", timestamp: "2026-03-05T10:00:00.000Z" }],
    createdAt: "2026-03-05T10:00:00.000Z",
    updatedAt: "2026-03-05T10:00:00.000Z",
    ...over,
  };
}

describe("IssueCard", () => {
  it("links to the detail route with status text, classification, reporter and date", () => {
    render(<IssueCard issue={makeIssue()} />);
    expect(screen.getByRole("link", { name: "Burst pipe" })).toHaveAttribute("href", "/explore/i1");
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(ISSUE_CATEGORIES[0].label))).toBeInTheDocument();
    expect(screen.getByText(/Reported by Asha/)).toBeInTheDocument();
    expect(screen.getByText("Mar 5, 2026")).toBeInTheDocument();
  });

  it("an unclassified issue shows no category/severity text", () => {
    render(<IssueCard issue={makeIssue({ category: "", severity: "" })} />);
    expect(screen.getByText(/^Reported by Asha/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(ISSUE_CATEGORIES[0].label))).not.toBeInTheDocument();
  });
});

describe("IssueDetail", () => {
  it("renders the public Issue DTO read-only: title, status, reporter, description, classification, location, map region", () => {
    render(<IssueDetail issue={makeIssue({ status: "in_progress" })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Burst pipe" })).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText(/Line one/)).toBeInTheDocument();
    expect(screen.getByText(ISSUE_CATEGORIES[0].label)).toBeInTheDocument();
    expect(screen.getByText(ISSUE_SEVERITIES[0].label)).toBeInTheDocument();
    expect(screen.getByText("12.90000, 77.50000")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Map showing this issue's location" })).toBeInTheDocument();
  });

  it("status history lists recorded transitions; the creation entry reads 'Reported as'", () => {
    render(
      <IssueDetail
        issue={makeIssue({
          status: "acknowledged",
          statusHistory: [
            { fromStatus: null, toStatus: "open", actor: "u1", timestamp: "2026-03-05T10:00:00.000Z" },
            { fromStatus: "open", toStatus: "acknowledged", actor: "u2", timestamp: "2026-03-06T10:00:00.000Z" },
          ],
        })}
      />,
    );
    const items = within(screen.getByRole("region", { name: "Status history" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Reported as Open · Mar 5, 2026");
    expect(items[1]).toHaveTextContent("Open → Acknowledged · Mar 6, 2026");
    // The actor id is not rendered.
    expect(screen.queryByText("u2")).not.toBeInTheDocument();
  });

  it("offers no lifecycle/transition controls (D-3a stays out of this surface)", () => {
    render(<IssueDetail issue={makeIssue({ status: "acknowledged" })} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    for (const name of [/acknowledge/i, /resolve/i, /verify/i, /progress/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("omits unclassified fields and an unusable location instead of rendering blanks", () => {
    render(
      <IssueDetail
        issue={makeIssue({
          category: "",
          severity: "",
          statusHistory: [],
          location: { type: "Point", coordinates: [999, 0] },
        })}
      />,
    );
    expect(screen.queryByText("Category")).not.toBeInTheDocument();
    expect(screen.queryByText("Severity")).not.toBeInTheDocument();
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
    expect(screen.getByText("No status changes recorded.")).toBeInTheDocument();
  });
});

describe("IssueStatusFilter", () => {
  it("offers All plus the five existing statuses as links; marks the active one", () => {
    render(<IssueStatusFilter status="resolved" />);
    const nav = screen.getByRole("navigation", { name: "Filter by status" });
    expect(within(nav).getAllByRole("link")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/explore");
    expect(screen.getByRole("link", { name: "In progress" })).toHaveAttribute("href", "/explore?status=in_progress");
    expect(screen.getByRole("link", { name: "Resolved" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
  });

  it("with no filter, All is current", () => {
    render(<IssueStatusFilter />);
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  });
});
