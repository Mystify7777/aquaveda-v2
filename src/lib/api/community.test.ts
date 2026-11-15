import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCommunityActivity } from "@/lib/api/community";

function mockFetch(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
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

describe("getCommunityActivity", () => {
  it("uses the locked public activity endpoint and page/limit query", async () => {
    mockFetch({
      success: true,
      data: { items: [], page: 2, limit: 50, total: 0, totalPages: 0 },
      message: "Community activity retrieved",
    });

    await getCommunityActivity({ page: 2, limit: 50 });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/community/activity?page=2&limit=50",
      expect.anything(),
    );
  });
});
