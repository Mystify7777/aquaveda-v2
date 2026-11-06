import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { ApiError } from "@/lib/api/client";
import type { Dashboard } from "@/lib/api/types/dashboard";

const mockGetDashboard = vi.fn();
vi.mock("@/lib/api/dashboard", () => ({ getDashboard: () => mockGetDashboard() }));

const ZERO_ISSUES = { open: 0, acknowledged: 0, in_progress: 0, resolved: 0, verified: 0 };
const ZERO: Dashboard = {
  platform: { issues: { total: 0, byStatus: ZERO_ISSUES }, knowledge: { approved: 0 }, projects: { total: 0 } },
  mine: {
    issuesReported: { total: 0, byStatus: ZERO_ISSUES },
    knowledge: { total: 0, byStatus: { draft: 0, pending_review: 0, approved: 0, rejected: 0 } },
    projects: { created: 0, contributing: 0 },
  },
};

// Distinct values everywhere so a mislabelled or swapped number cannot pass.
const POPULATED: Dashboard = {
  platform: {
    issues: { total: 1234, byStatus: { open: 1000, acknowledged: 100, in_progress: 70, resolved: 40, verified: 24 } },
    knowledge: { approved: 57 },
    projects: { total: 8 },
  },
  mine: {
    issuesReported: { total: 15, byStatus: { open: 5, acknowledged: 4, in_progress: 3, resolved: 2, verified: 1 } },
    knowledge: { total: 11, byStatus: { draft: 6, pending_review: 3, approved: 2, rejected: 0 } },
    projects: { created: 2, contributing: 9 },
  },
};

/** The number shown next to a label, inside the nearest list/tile that contains it. */
function valueFor(scope: HTMLElement, label: string): string {
  const term = within(scope).getByText(label, { selector: "dt" });
  return term.parentElement!.querySelector("dd")!.textContent ?? "";
}

beforeEach(() => {
  mockGetDashboard.mockReset();
});

describe("DashboardView: loading", () => {
  it("announces loading while the request is pending, with no data or error shown", () => {
    mockGetDashboard.mockReturnValue(new Promise(() => {}));
    render(<DashboardView />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your dashboard...");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});

describe("DashboardView: populated", () => {
  it("renders the platform block", async () => {
    mockGetDashboard.mockResolvedValue(POPULATED);
    render(<DashboardView />);
    const platform = await screen.findByRole("region", { name: "Across AquaVeda" });
    expect(valueFor(platform, "Issues reported")).toBe("1,234");
    expect(valueFor(platform, "Approved articles")).toBe("57");
    expect(valueFor(platform, "Projects")).toBe("8");
  });

  it("renders the platform issue status breakdown with text labels, in lifecycle order", async () => {
    mockGetDashboard.mockResolvedValue(POPULATED);
    render(<DashboardView />);
    const platform = await screen.findByRole("region", { name: "Across AquaVeda" });
    const card = within(platform).getByRole("heading", { name: "Issues by status" }).parentElement!;
    const labels = within(card).getAllByRole("term").map((t) => t.textContent);
    expect(labels).toEqual(["Open", "Acknowledged", "In progress", "Resolved", "Verified", "All issues"]);
    expect(valueFor(card, "Open")).toBe("1,000");
    expect(valueFor(card, "Acknowledged")).toBe("100");
    expect(valueFor(card, "In progress")).toBe("70");
    expect(valueFor(card, "Resolved")).toBe("40");
    expect(valueFor(card, "Verified")).toBe("24");
    expect(valueFor(card, "All issues")).toBe("1,234");
  });

  it("renders the personal block, clearly separate from the platform block", async () => {
    mockGetDashboard.mockResolvedValue(POPULATED);
    render(<DashboardView />);
    const mine = await screen.findByRole("region", { name: "Your activity" });
    expect(valueFor(mine, "Issues you reported")).toBe("15");
    expect(valueFor(mine, "Articles you wrote")).toBe("11");
    expect(valueFor(mine, "Projects you created")).toBe("2");
    expect(valueFor(mine, "Projects you contribute to")).toBe("9");

    const platform = screen.getByRole("region", { name: "Across AquaVeda" });
    expect(within(platform).queryByText("Issues you reported")).not.toBeInTheDocument();
    expect(within(mine).queryByText("Approved articles")).not.toBeInTheDocument();
  });

  it("renders my issue and article status breakdowns", async () => {
    mockGetDashboard.mockResolvedValue(POPULATED);
    render(<DashboardView />);
    const mine = await screen.findByRole("region", { name: "Your activity" });

    const issues = within(mine).getByRole("heading", { name: "Your issues by status" }).parentElement!;
    expect([...["Open", "Acknowledged", "In progress", "Resolved", "Verified"]].map((l) => valueFor(issues, l))).toEqual([
      "5", "4", "3", "2", "1",
    ]);
    expect(valueFor(issues, "All your issues")).toBe("15");

    const articles = within(mine).getByRole("heading", { name: "Your articles by status" }).parentElement!;
    expect(within(articles).getAllByRole("term").map((t) => t.textContent)).toEqual([
      "Draft", "Pending review", "Approved", "Rejected", "All your articles",
    ]);
    expect(["Draft", "Pending review", "Approved", "Rejected"].map((l) => valueFor(articles, l))).toEqual(["6", "3", "2", "0"]);
    expect(valueFor(articles, "All your articles")).toBe("11");
  });

  it("uses semantic headings: sections are h2, breakdown cards h3", async () => {
    mockGetDashboard.mockResolvedValue(POPULATED);
    render(<DashboardView />);
    await screen.findByRole("region", { name: "Across AquaVeda" });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Across AquaVeda", "Your activity"]);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Issues by status", "Your issues by status", "Your articles by status",
    ]);
  });
});

describe("DashboardView: zero state", () => {
  it("an all-zero response is a complete, successful render, not an error or an empty page", async () => {
    mockGetDashboard.mockResolvedValue(ZERO);
    render(<DashboardView />);
    const platform = await screen.findByRole("region", { name: "Across AquaVeda" });
    const mine = screen.getByRole("region", { name: "Your activity" });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    for (const label of ["Issues reported", "Approved articles", "Projects"]) expect(valueFor(platform, label)).toBe("0");
    for (const label of ["Issues you reported", "Articles you wrote", "Projects you created", "Projects you contribute to"]) {
      expect(valueFor(mine, label)).toBe("0");
    }
    // every status row is still present, with a 0
    const allRows = screen.getAllByRole("term");
    const zeros = screen.getAllByRole("definition").filter((d) => d.textContent === "0");
    expect(zeros).toHaveLength(allRows.length);
    expect(allRows).toHaveLength(3 + 6 + 4 + 6 + 5);
  });
});

describe("DashboardView: error", () => {
  it("shows an accessible alert with generic copy and never the raw server detail", async () => {
    mockGetDashboard.mockRejectedValue(
      new ApiError("MongoServerError: E11000 at /srv/app/server.js:42 secret=abc123", "http", 500),
    );
    render(<DashboardView />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We could not load your dashboard. Try again.");
    expect(document.body.textContent).not.toMatch(/Mongo|E11000|server\.js|secret|abc123|500/);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("renders no fabricated metrics while failed", async () => {
    mockGetDashboard.mockRejectedValue(new ApiError("boom", "http", 500));
    render(<DashboardView />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("term")).not.toBeInTheDocument();
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
  });

  it("network failure uses the unreachable-service copy", async () => {
    mockGetDashboard.mockRejectedValue(new ApiError("Failed to fetch", "network"));
    render(<DashboardView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The service is unreachable right now");
  });

  it("a 401 follows the established session behavior: sign-in copy and link, no retry loop", async () => {
    mockGetDashboard.mockRejectedValue(new ApiError("an authenticated actor is required", "http", 401));
    render(<DashboardView />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your session is no longer valid. Sign in again to continue.");
    expect(within(alert).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(mockGetDashboard).toHaveBeenCalledTimes(1);
  });

  it("Try again re-requests the dashboard and recovers", async () => {
    mockGetDashboard.mockRejectedValueOnce(new ApiError("boom", "http", 500)).mockResolvedValueOnce(POPULATED);
    render(<DashboardView />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Your activity" })).toBeInTheDocument();
    expect(mockGetDashboard).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
