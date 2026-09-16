import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCommentThread } from "@/lib/api/comments";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
  } as Response);
}

const SAMPLE_COMMENT = {
  _id: "c-1",
  refType: "ISSUE",
  refId: "issue-1",
  author: { _id: "user-1", name: "Commenter", role: "USER" },
  body: "Affecting my street too.",
  parentComment: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  replies: [],
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getCommentThread", () => {
  it("sends refType/refId as query params, not a path segment", async () => {
    mockFetchOnce({ success: true, data: [], message: "ok" });
    await getCommentThread("ISSUE", "issue-1");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/comments?refType=ISSUE&refId=issue-1",
      expect.anything(),
    );
  });

  it("returns a plain array, not a paginated envelope", async () => {
    mockFetchOnce({ success: true, data: [SAMPLE_COMMENT], message: "ok" });
    const result = await getCommentThread("ISSUE", "issue-1");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].body).toBe("Affecting my street too.");
  });

  it("throws a 404 ApiError (TARGET_NOT_FOUND) for a nonexistent or non-public target", async () => {
    mockFetchOnce(
      { success: false, data: null, message: "no ISSUE document found", code: "TARGET_NOT_FOUND" },
      false,
      404,
    );
    await expect(getCommentThread("ISSUE", "nonexistent")).rejects.toMatchObject({
      code: "TARGET_NOT_FOUND",
      status: 404,
    });
  });
});
