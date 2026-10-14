import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import ExplorePage from "@/app/explore/page";
import ExploreLoading from "@/app/explore/loading";
import { ApiError } from "@/lib/api/client";
import type { Issue } from "@/lib/api/types/issue";

const mockGetIssues = vi.fn();
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url), usePathname: () => "/explore" }));
vi.mock("@/lib/api/issues", () => ({ getIssues: (q: unknown) => mockGetIssues(q) }));
vi.mock("@/components/issues/report-issue-button", () => ({
  ReportIssueButton: () => <button>Report an issue</button>,
}));
vi.mock("@/components/issues/issue-map-loader", () => ({
  IssueMapLoader: ({ issues, label, areaSearch }: { issues: Issue[]; label: string; areaSearch?: { filters: unknown } }) => (
    <div role="region" aria-label={label} data-area-filters={JSON.stringify(areaSearch?.filters ?? null)}>{`map:${issues.map((i) => i._id).join(",")}`}</div>
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
async function renderPage(sp: Record<string, string | string[] | undefined> = {}) {
  render(await ExplorePage({ searchParams: Promise.resolve(sp) }));
}

describe("/explore", () => {
  beforeEach(() => {
    mockGetIssues.mockReset();
    mockRedirect.mockClear();
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

  it("with no discovery filters the request is unchanged: only page and status", async () => {
    mockGetIssues.mockResolvedValue(pageOf([issue(1)]));
    await renderPage({ page: "3", status: "resolved" });
    expect(mockGetIssues).toHaveBeenCalledTimes(1);
    expect(mockGetIssues.mock.calls[0][0]).toEqual({ page: 3, status: "resolved" });
    expect(Object.keys(mockGetIssues.mock.calls[0][0]).sort()).toEqual(["page", "status"]);
    await renderPage();
    expect(Object.keys(mockGetIssues.mock.calls[1][0])).toEqual(["page"]);
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

const BBOX = "77.5,12.8,77.7,13.1";

describe("/explore discovery filters (#82)", () => {
  beforeEach(() => {
    mockGetIssues.mockReset();
    mockRedirect.mockClear();
    mockGetIssues.mockResolvedValue(pageOf([issue(1)]));
  });

  it("forwards every filter with status and pagination, exactly as the #41 contract names them", async () => {
    await renderPage({ status: "open", category: "water_quality", severity: "high", q: "main road", bbox: BBOX, page: "2" });
    expect(mockGetIssues).toHaveBeenCalledWith({
      page: 2, status: "open", category: "water_quality", severity: "high", q: "main road", bbox: BBOX,
    });
  });

  it.each([
    [{ category: "water_quality" }, { page: 1, category: "water_quality" }],
    [{ severity: "critical" }, { page: 1, severity: "critical" }],
    [{ q: "leak" }, { page: 1, q: "leak" }],
    [{ bbox: BBOX }, { page: 1, bbox: BBOX }],
    [{ category: "other", severity: "low" }, { page: 1, category: "other", severity: "low" }],
  ])("combination %j", async (sp, expected) => {
    await renderPage(sp);
    expect(mockGetIssues.mock.calls[0][0]).toEqual(expected);
  });

  it("unrecognized category/severity are ignored, not forwarded", async () => {
    await renderPage({ category: "bogus", severity: "extreme" });
    expect(mockGetIssues.mock.calls[0][0]).toEqual({ page: 1 });
  });

  it("form is prefilled from the URL and carries status + bbox (never page) as hidden fields", async () => {
    await renderPage({ status: "open", category: "water_quality", severity: "high", q: "pump", bbox: BBOX, page: "3" });
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/explore");
    expect(screen.getByLabelText("Search")).toHaveValue("pump");
    expect(screen.getByLabelText("Category")).toHaveValue("water_quality");
    expect(screen.getByLabelText("Severity")).toHaveValue("high");
    const hidden = [...form.querySelectorAll("input[type=hidden]")].map((i) => [i.getAttribute("name"), i.getAttribute("value")]);
    expect(hidden).toEqual([["status", "open"], ["bbox", BBOX]]);
    expect(form.querySelector("[name=page]")).toBeNull();
  });

  it("category/severity options come from the canonical vocabulary, plus an 'Any' option", async () => {
    await renderPage();
    const options = (label: string) => [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.value);
    expect(options("Category")).toEqual(["", "supply_shortage", "leakage_wastage", "water_quality", "flooding_drainage", "damaged_infrastructure", "other"]);
    expect(options("Severity")).toEqual(["", "low", "medium", "high", "critical"]);
  });

  it("pagination links keep every active filter in canonical order; page 1 link is bare of page", async () => {
    mockGetIssues.mockResolvedValue(pageOf([issue(1)], { page: 2, total: 60, totalPages: 3 }));
    await renderPage({ page: "2", bbox: BBOX, q: "pump", status: "open", category: "other" });
    const prefix = "/explore?status=open&category=other&q=pump&bbox=77.5%2C12.8%2C77.7%2C13.1";
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", `${prefix}&page=3`);
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", prefix);
  });

  it("status links keep discovery filters and reset the page", async () => {
    await renderPage({ page: "2", q: "pump", category: "other" });
    expect(screen.getByRole("link", { name: "Resolved" })).toHaveAttribute("href", "/explore?status=resolved&category=other&q=pump");
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/explore?category=other&q=pump");
  });

  it("Clear filters appears only when a discovery filter is active, clears them, and keeps status", async () => {
    await renderPage({ status: "open" });
    expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();
    cleanup();
    await renderPage({ status: "open", q: "pump", bbox: BBOX });
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/explore?status=open");
    expect(screen.getByRole("link", { name: "Clear map area" })).toHaveAttribute("href", "/explore?status=open&q=pump");
  });

  it("filtered-empty: says the filters matched nothing and offers a way out; not the 'no issues reported yet' copy", async () => {
    mockGetIssues.mockResolvedValue(pageOf([]));
    await renderPage({ status: "open", q: "pump" });
    expect(screen.getByRole("heading", { name: "No issues match these filters" })).toBeInTheDocument();
    expect(screen.queryByText("No issues reported yet")).not.toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Clear filters" });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((l) => expect(l).toHaveAttribute("href", "/explore?status=open"));
    expect(screen.getByRole("button", { name: "Report an issue" })).toBeInTheDocument();
  });

  it("status-only empty keeps the original copy", async () => {
    mockGetIssues.mockResolvedValue(pageOf([]));
    await renderPage({ status: "verified" });
    expect(screen.getByRole("heading", { name: "No verified issues" })).toBeInTheDocument();
  });

  it("page past the end with filters links back to the canonical first page", async () => {
    mockGetIssues.mockResolvedValue(pageOf([], { page: 9, total: 3, totalPages: 1 }));
    await renderPage({ page: "9", category: "other", q: "pump" });
    expect(screen.getByRole("link", { name: "Back to first page" })).toHaveAttribute("href", "/explore?category=other&q=pump");
  });

  it("API failure with filters: alert, retry to the same canonical URL, filters stay usable", async () => {
    mockGetIssues.mockRejectedValue(new ApiError("Failed to fetch", "network"));
    await renderPage({ page: "2", category: "other", q: "pump" });
    expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/i);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/explore?category=other&q=pump&page=2");
    expect(screen.getByLabelText("Search")).toHaveValue("pump");
    expect(screen.queryByRole("heading", { name: /No issues/ })).not.toBeInTheDocument();
  });

  it.each([
    [{ q: "a" }, /q must be at least 2/],
    [{ q: "x".repeat(101) }, /q must be at most 100/],
    [{ bbox: "0,0,50,1" }, /bbox must not span more than 10 degrees/],
    [{ bbox: "nope" }, /bbox must be four numbers/],
  ])("contract-invalid %j is explained with the backend wording and never sent", async (sp, message) => {
    await renderPage(sp);
    expect(mockGetIssues).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("heading", { name: /No issues/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/explore");
  });

  it("an invalid q stays in the input so it can be corrected", async () => {
    await renderPage({ q: "a" });
    expect(screen.getByLabelText("Search")).toHaveValue("a");
  });

  it.each([
    [{ q: "", category: "", severity: "" }, "/explore"],
    [{ q: "", status: "open", page: "2" }, "/explore?status=open&page=2"],
    [{ q: "  pump ", category: "" }, "/explore?q=pump"],
    [{ bbox: "" }, "/explore"],
  ])("blank or padded GET-form params %j redirect to the canonical URL %s", async (sp, url) => {
    await expect(renderPage(sp)).rejects.toThrow(`NEXT_REDIRECT:${url}`);
    expect(mockGetIssues).not.toHaveBeenCalled();
  });

  it("canonical and legacy URLs do not redirect", async () => {
    await renderPage({ status: "open", page: "2" });
    await renderPage({ status: "" });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("anonymous browse works with filters (no auth dependency)", async () => {
    await renderPage({ q: "pump" });
    expect(screen.getByRole("link", { name: "Issue 1" })).toHaveAttribute("href", "/explore/i1");
  });
});
