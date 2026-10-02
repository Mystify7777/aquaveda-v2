import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import ExplorePage from "@/app/explore/page";
import ExploreLoading from "@/app/explore/loading";
import { ApiError } from "@/lib/api/client";
import type { Issue } from "@/lib/api/types/issue";

const mockGetIssues = vi.fn();
vi.mock("@/lib/api/issues", () => ({ getIssues: (q: unknown) => mockGetIssues(q) }));
vi.mock("@/components/issues/report-issue-button", () => ({
  ReportIssueButton: () => <button>Report an issue</button>,
}));
vi.mock("@/components/issues/issue-map-loader", () => ({
  IssueMapLoader: ({ issues, label }: { issues: Issue[]; label: string }) => (
    <div role="region" aria-label={label}>{`map:${issues.map((i) => i._id).join(",")}`}</div>
  ),
}));

function issue(n: number, over: Partial<Issue> = {}): Issue {
  return {
    _id: `i${n}`,
    title: `Issue ${n}`,
    description: `Desc ${n}`,
    location: { type: "Point", coordinates: [77 + n, 12] },
    severity: "",
    category: "",
    domain: "water",
    status: "open",
    reportedBy: { _id: "u1", name: "Asha", role: "USER" },
    statusHistory: [],
    createdAt: "2026-03-05T10:00:00.000Z",
    updatedAt: "2026-03-05T10:00:00.000Z",
    ...over,
  };
}
const pageOf = (items: Issue[], over = {}) => ({
  items, page: 1, limit: 20, total: items.length, totalPages: items.length ? 1 : 0, ...over,
});
async function renderPage(sp: { page?: string | string[]; status?: string | string[] } = {}) {
  render(await ExplorePage({ searchParams: Promise.resolve(sp) }));
}

describe("/explore", () => {
  beforeEach(() => {
    mockGetIssues.mockReset();
  });

  it("anonymous browse: lists public issues linking to detail, and maps the same page of issues", async () => {
    mockGetIssues.mockResolvedValue(pageOf([issue(1), issue(2)]));
    await renderPage();
    expect(mockGetIssues).toHaveBeenCalledWith({ page: 1, status: undefined });
    expect(screen.getByRole("heading", { level: 1, name: "Explore" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Issue 1" })).toHaveAttribute("href", "/explore/i1");
    expect(screen.getByRole("link", { name: "Issue 2" })).toHaveAttribute("href", "/explore/i2");
    expect(screen.getByRole("region", { name: "Map of issues on this page" })).toHaveTextContent("map:i1,i2");
    expect(screen.getByText(/2 issues · page 1 of 1/)).toBeInTheDocument();
    expect(screen.getByText(/map shows the issues on this page/i)).toBeInTheDocument();
  });

  it("keeps the reporting entry point (#44) and a skip link past the map", async () => {
    mockGetIssues.mockResolvedValue(pageOf([issue(1)]));
    await renderPage();
    expect(screen.getByRole("button", { name: "Report an issue" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip map to issue list" })).toHaveAttribute("href", "#issue-list");
    expect(document.getElementById("issue-list")).toBeInTheDocument();
  });

  it("DOM order is filters -> skip link -> map -> #issue-list -> pagination, so the skip link really bypasses the map", async () => {
    mockGetIssues.mockResolvedValue(pageOf([issue(1), issue(2)], { page: 2, total: 60, totalPages: 3 }));
    await renderPage({ page: "2" });
    const filters = screen.getByRole("navigation", { name: "Filter by status" });
    const skip = screen.getByRole("link", { name: "Skip map to issue list" });
    const map = screen.getByRole("region", { name: "Map of issues on this page" });
    const target = document.getElementById("issue-list")!;
    const pagination = screen.getByRole("navigation", { name: "Issue pages" });

    const precedes = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(precedes(filters, skip)).toBe(true);
    expect(precedes(skip, map)).toBe(true);
    expect(precedes(map, target)).toBe(true);
    expect(precedes(target, pagination)).toBe(true);
    // The skip target is the list itself, not a container that also holds the map.
    expect(target.contains(map)).toBe(false);
    expect(skip.getAttribute("href")).toBe(`#${target.id}`);
  });

  it("sends only the supported contract parameters: page and status", async () => {
    mockGetIssues.mockResolvedValue(pageOf([issue(1)]));
    await renderPage({ page: "3", status: "resolved" });
    expect(mockGetIssues).toHaveBeenCalledTimes(1);
    expect(mockGetIssues.mock.calls[0][0]).toEqual({ page: 3, status: "resolved" });
    expect(Object.keys(mockGetIssues.mock.calls[0][0]).sort()).toEqual(["page", "status"]);
  });

  it.each([["closed"], [""], ["OPEN"]])("an unrecognized status %j is ignored, not forwarded", async (raw) => {
    mockGetIssues.mockResolvedValue(pageOf([issue(1)]));
    await renderPage({ status: raw });
    expect(mockGetIssues).toHaveBeenCalledWith({ page: 1, status: undefined });
  });

  it.each([["abc"], ["0"], ["-2"], ["1.5"]])("invalid page %s falls back to 1", async (raw) => {
    mockGetIssues.mockResolvedValue(pageOf([]));
    await renderPage({ page: raw });
    expect(mockGetIssues).toHaveBeenCalledWith({ page: 1, status: undefined });
  });

  it("status filter nav marks the active status; pagination links preserve it", async () => {
    mockGetIssues.mockResolvedValue(pageOf([issue(1)], { page: 2, total: 60, totalPages: 3 }));
    await renderPage({ page: "2", status: "open" });
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/explore?status=open&page=3");
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/explore?status=open");
  });

  it("empty (no filter): welcoming empty state; the report entry point remains", async () => {
    mockGetIssues.mockResolvedValue(pageOf([]));
    await renderPage();
    expect(screen.getByRole("heading", { name: "No issues reported yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report an issue" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Map/ })).not.toBeInTheDocument();
  });

  it("empty (filtered): says so, and the filter stays available to leave it", async () => {
    mockGetIssues.mockResolvedValue(pageOf([]));
    await renderPage({ status: "verified" });
    expect(screen.getByRole("heading", { name: "No verified issues" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/explore");
  });

  it("page past the end: distinct empty state linking back, preserving the filter", async () => {
    mockGetIssues.mockResolvedValue(pageOf([], { page: 9, total: 3, totalPages: 1 }));
    await renderPage({ page: "9", status: "open" });
    expect(screen.getByRole("link", { name: "Back to first page" })).toHaveAttribute("href", "/explore?status=open");
  });

  it("network failure: alert with retry to the same URL; no fake empty state; reporting still offered", async () => {
    mockGetIssues.mockRejectedValue(new ApiError("Failed to fetch", "network"));
    await renderPage({ page: "2", status: "open" });
    expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/explore?status=open&page=2");
    expect(screen.queryByRole("heading", { name: /No issues/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report an issue" })).toBeInTheDocument();
  });

  it("HTTP failure: generic alert", async () => {
    mockGetIssues.mockRejectedValue(new ApiError("boom", "http", 500));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load issues/i);
  });

  it("non-API errors propagate to the error boundary", async () => {
    mockGetIssues.mockRejectedValue(new TypeError("bug"));
    await expect(ExplorePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("bug");
  });

  it("loading state is an announced status region", () => {
    render(<ExploreLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading issues...");
  });
});
