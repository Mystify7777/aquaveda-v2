import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { Issue } from "@/lib/api/types/issue";

const mockGetIssues = vi.fn();

vi.mock("@/lib/api/issues", () => ({
  getIssues: (query: unknown) => mockGetIssues(query),
}));

vi.mock("@/components/issues/issue-map-loader", () => ({
  IssueMapLoader: ({ issues, label }: { issues: Issue[]; label: string }) => (
    <div role="region" aria-label={label}>{issues.map((issue) => issue._id).join(",")}</div>
  ),
}));

import { LandingMapPreview } from "@/components/landing/landing-map-preview";

function issue(id = "i1"): Issue {
  return {
    _id: id,
    title: "Public issue",
    description: "A public issue",
    location: { type: "Point", coordinates: [77, 12] },
    severity: "",
    category: "",
    domain: "water",
    status: "open",
    reportedBy: { _id: "u1", name: "Asha", role: "USER" },
    statusHistory: [],
    createdAt: "2026-03-05T10:00:00.000Z",
    updatedAt: "2026-03-05T10:00:00.000Z",
  };
}

describe("LandingMapPreview", () => {
  beforeEach(() => mockGetIssues.mockReset());\n\n  afterEach(() => vi.useRealTimers());

  it("requests a small public preview without blocking the initial page render", async () => {
    mockGetIssues.mockResolvedValue({
      items: [issue(), issue("i2")],
      page: 1,
      limit: 8,
      total: 2,
      totalPages: 1,
    });

    render(<LandingMapPreview />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading public issue locations");
    expect(screen.getByText("PUBLIC ISSUE DATA")).toBeInTheDocument();
    expect(screen.queryByText("LIVE PUBLIC DATA")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Public map preview showing reported issues" })).toHaveTextContent("i1,i2"),
    );
    expect(mockGetIssues).toHaveBeenCalledWith({ page: 1, limit: 8 });
  });

  it("enters wake-up state after the documented threshold and recovers when the request succeeds", async () => {
    vi.useFakeTimers();

    let resolveRequest!: (value: {
      items: Issue[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    }) => void;

    const request = new Promise<{
      items: Issue[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    }>((resolve) => {
      resolveRequest = resolve;
    });
    request.catch(() => {});

    mockGetIssues.mockReturnValue(request);

    render(<LandingMapPreview />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading public issue locations");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(screen.getByRole("status")).toHaveTextContent("The service is taking a little longer to start.");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");

    await act(async () => {
      resolveRequest({
        items: [issue()],
        page: 1,
        limit: 8,
        total: 1,
        totalPages: 1,
      });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Public map preview showing reported issues" })).toHaveTextContent("i1"),
    );
    expect(screen.queryByText("The service is taking a little longer to start.")).not.toBeInTheDocument();
  });

  it("renders an honest empty state when no public issues exist", async () => {
    mockGetIssues.mockResolvedValue({
      items: [],
      page: 1,
      limit: 8,
      total: 0,
      totalPages: 0,
    });

    render(<LandingMapPreview />);

    await waitFor(() => expect(screen.getByText("No public issues to plot yet.")).toBeInTheDocument());
  });

  it("keeps the landing page usable when the issue service fails", async () => {
    const failure = new Error("offline");

    mockGetIssues.mockResolvedValue({
      get items(): Issue[] {
        throw failure;
      },
      page: 1,
      limit: 8,
      total: 0,
      totalPages: 0,
    });

    render(<LandingMapPreview />);

    expect(mockGetIssues).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByText("The public map is taking a moment.")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/explore");
  });
});
