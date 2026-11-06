import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { DashboardView } from "@/components/dashboard/dashboard-view";

/**
 * Contract usage (#54): the real API module is exercised end to end with a
 * stubbed `fetch`. The Dashboard must make exactly ONE request, to the
 * Dashboard endpoint, and render what it returns. Any other call (Issues,
 * Knowledge, Projects...) would be client-side aggregation, which the
 * backend contract exists to prevent.
 */

const BODY = {
  success: true,
  message: "Dashboard retrieved",
  data: {
    platform: {
      issues: { total: 7, byStatus: { open: 3, acknowledged: 1, in_progress: 1, resolved: 1, verified: 1 } },
      knowledge: { approved: 3 },
      projects: { total: 4 },
    },
    mine: {
      issuesReported: { total: 4, byStatus: { open: 2, acknowledged: 0, in_progress: 1, resolved: 0, verified: 1 } },
      knowledge: { total: 5, byStatus: { draft: 1, pending_review: 1, approved: 2, rejected: 1 } },
      projects: { created: 2, contributing: 2 },
    },
  },
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(BODY),
  } as Response);
});
afterEach(() => vi.restoreAllMocks());

describe("DashboardView consumes the Dashboard contract directly", () => {
  it("makes exactly one request, to /api/v1/dashboard, and renders the returned values verbatim", async () => {
    render(<DashboardView />);
    expect(await screen.findByRole("region", { name: "Your activity" })).toBeInTheDocument();

    const urls = vi.mocked(global.fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(["https://api.aquaveda.com/api/v1/dashboard"]);

    // Values come from the response, not from any computation here.
    expect(screen.getByText("Issues reported").nextElementSibling).toHaveTextContent("7");
    expect(screen.getByText("Projects you contribute to").nextElementSibling).toHaveTextContent("2");
  });
});
