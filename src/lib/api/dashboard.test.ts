import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ApiError } from "@/lib/api/client";
import { getDashboard } from "@/lib/api/dashboard";
import type { Dashboard } from "@/lib/api/types/dashboard";

const ZERO_ISSUES = { open: 0, acknowledged: 0, in_progress: 0, resolved: 0, verified: 0 };
const SAMPLE: Dashboard = {
  platform: {
    issues: { total: 0, byStatus: ZERO_ISSUES },
    knowledge: { approved: 0 },
    projects: { total: 0 },
  },
  mine: {
    issuesReported: { total: 0, byStatus: ZERO_ISSUES },
    knowledge: { total: 0, byStatus: { draft: 0, pending_review: 0, approved: 0, rejected: 0 } },
    projects: { created: 0, contributing: 0 },
  },
};

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
  } as Response);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("getDashboard", () => {
  it("requests GET /api/v1/dashboard once, with the session cookie and no caching", async () => {
    mockFetchOnce({ success: true, data: SAMPLE, message: "Dashboard retrieved" });
    await getDashboard();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/dashboard",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
    const init = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    expect(init.method).toBeUndefined(); // a plain GET
  });

  it("returns the contract data unchanged", async () => {
    mockFetchOnce({ success: true, data: SAMPLE, message: "Dashboard retrieved" });
    expect(await getDashboard()).toEqual(SAMPLE);
  });

  it("an unauthenticated response rejects with an ApiError carrying the 401", async () => {
    mockFetchOnce({ success: false, data: null, message: "an authenticated actor is required", code: "UNAUTHORIZED" }, false, 401);
    await expect(getDashboard()).rejects.toMatchObject({ name: "ApiError", status: 401 });
    await expect(getDashboard()).rejects.toBeInstanceOf(ApiError);
  });
});
