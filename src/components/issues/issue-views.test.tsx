import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
    // The only control is the Issue ID copy action (#87) — not a lifecycle write.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Copy ID"]);
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
    render(<IssueStatusFilter filters={{ status: "resolved" }} />);
    const nav = screen.getByRole("navigation", { name: "Filter by status" });
    expect(within(nav).getAllByRole("link")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/explore");
    expect(screen.getByRole("link", { name: "In progress" })).toHaveAttribute("href", "/explore?status=in_progress");
    expect(screen.getByRole("link", { name: "Resolved" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
  });

  it("changing status keeps the other filters and resets the page", () => {
    render(<IssueStatusFilter filters={{ status: "open", category: "water_quality", q: "pump", bbox: "77,12,78,13" }} />);
    expect(screen.getByRole("link", { name: "Resolved" })).toHaveAttribute(
      "href",
      "/explore?status=resolved&category=water_quality&q=pump&bbox=77%2C12%2C78%2C13",
    );
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/explore?category=water_quality&q=pump&bbox=77%2C12%2C78%2C13",
    );
  });

  it("with no filter, All is current", () => {
    render(<IssueStatusFilter filters={{}} />);
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  });
});

const ID = "64b7f0c2a1b2c3d4e5f60718";

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("Issue ID copy surfaces (#87)", () => {
  it("detail shows the ID + copy for an eligible issue and preserves existing content", () => {
    render(<IssueDetail issue={makeIssue({ _id: ID, status: "acknowledged" })} />);
    expect(screen.getByText(ID)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy id/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Burst pipe" })).toBeInTheDocument();
  });

  it("detail omits the ID for an open (ineligible) issue", () => {
    render(<IssueDetail issue={makeIssue({ _id: ID, status: "open" })} />);
    expect(screen.queryByText(ID)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("card offers copy for eligible issues without altering its link; none for open", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const { unmount } = render(<IssueCard issue={makeIssue({ _id: ID, status: "in_progress" })} />);
    expect(screen.getByRole("link", { name: "Burst pipe" })).toHaveAttribute("href", `/explore/${ID}`);
    await userEvent.click(screen.getByRole("button", { name: "Copy issue ID" }));
    expect(writeText).toHaveBeenCalledWith(ID);
    unmount();
    render(<IssueCard issue={makeIssue({ _id: ID, status: "open" })} />);
    expect(screen.queryByRole("button", { name: "Copy issue ID" })).not.toBeInTheDocument();
  });
});
