import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ApiError } from "@/lib/api/client";
import { getIssueRecommendations } from "@/lib/api/recommendations";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
  } as Response);
}

const POPULATED = {
  issueId: "issue-1",
  contextStatus: "classified" as const,
  recommendations: [
    {
      id: "leakage-wastage",
      suggestion: "Inspect the reported area.",
      reason: 'The Issue is classified as "leakage_wastage".',
    },
  ],
};

describe("getIssueRecommendations", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the recommendation endpoint with no-store caching", async () => {
    mockFetchOnce({ success: true, data: POPULATED, message: "Recommendations retrieved" });

    await getIssueRecommendations("issue/1");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/issues/issue%2F1/recommendations",
      expect.objectContaining({ method: "GET", cache: "no-store", credentials: "include" }),
    );
  });

  it("unwraps populated recommendations from the API envelope", async () => {
    mockFetchOnce({ success: true, data: POPULATED, message: "Recommendations retrieved" });

    await expect(getIssueRecommendations("issue-1")).resolves.toEqual(POPULATED);
  });

  it("preserves insufficient context", async () => {
    const data = { issueId: "issue-1", contextStatus: "insufficient_context" as const, recommendations: [] };
    mockFetchOnce({ success: true, data, message: "Recommendations retrieved" });

    await expect(getIssueRecommendations("issue-1")).resolves.toEqual(data);
  });

  it("preserves classified context with no matches", async () => {
    const data = { issueId: "issue-1", contextStatus: "classified" as const, recommendations: [] };
    mockFetchOnce({ success: true, data, message: "Recommendations retrieved" });

    await expect(getIssueRecommendations("issue-1")).resolves.toEqual(data);
  });

  it("propagates API failures as ApiError values", async () => {
    mockFetchOnce(
      { success: false, data: null, message: "Issue not found", code: "NOT_FOUND" },
      false,
      404,
    );

    await expect(getIssueRecommendations("issue-1")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    await expect(getIssueRecommendations("issue-1")).rejects.toBeInstanceOf(ApiError);
  });

  it("forwards the caller AbortSignal", async () => {
    const controller = new AbortController();
    global.fetch = vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      }),
    ) as unknown as typeof fetch;

    const request = getIssueRecommendations("issue-1", { signal: controller.signal }).catch(() => undefined);
    await Promise.resolve();

    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    controller.abort();
    expect((init.signal as AbortSignal).aborted).toBe(true);
    await request;
  });
});
