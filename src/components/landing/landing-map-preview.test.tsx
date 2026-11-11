import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
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
  beforeEach(() => mockGetIssues.mockReset());

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
    let rejectRequest!: (reason: unknown) => void;

    const request = new Promise<never>((_, reject) => {
      rejectRequest = reject;
    });

    // The component will also await this promise. This handler makes the
    // test-owned rejection explicitly handled before we trigger it.
    request.catch(() => {});

    mockGetIssues.mockReturnValue(request);

    render(<LandingMapPreview />);

    expect(mockGetIssues).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeInTheDocument();

    await act(async () => {
      rejectRequest(new Error("offline"));
    });

    await waitFor(() => {
      expect(screen.getByText("The public map is taking a moment.")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/explore");
  });
});
