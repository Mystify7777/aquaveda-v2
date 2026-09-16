import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getKnowledgeList, getKnowledgeArticle } from "@/lib/api/knowledge";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
  } as Response);
}

const SAMPLE_ARTICLE = {
  _id: "k-1",
  title: "Drip irrigation basics",
  body: "How to set up drip irrigation.",
  region: "",
  status: "approved",
  author: { _id: "user-1", name: "Author", role: "USER" },
  reviewHistory: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getKnowledgeList", () => {
  it("requests the correct URL and has no status query param available (approved-only, unconditional)", async () => {
    mockFetchOnce({ success: true, data: { items: [], page: 1, limit: 20, total: 0, totalPages: 0 }, message: "ok" });
    await getKnowledgeList({ page: 1, limit: 20 });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/knowledge?page=1&limit=20",
      expect.anything(),
    );
  });

  it("returns the parsed paginated response", async () => {
    mockFetchOnce({
      success: true,
      data: { items: [SAMPLE_ARTICLE], page: 1, limit: 20, total: 1, totalPages: 1 },
      message: "ok",
    });
    const result = await getKnowledgeList();
    expect(result.items[0].status).toBe("approved");
  });
});

describe("getKnowledgeArticle", () => {
  it("returns the article on success", async () => {
    mockFetchOnce({ success: true, data: SAMPLE_ARTICLE, message: "ok" });
    const result = await getKnowledgeArticle("k-1");
    expect(result.title).toBe("Drip irrigation basics");
  });

  it("throws a 404 ApiError for a non-approved or nonexistent article (indistinguishable, per backend design)", async () => {
    mockFetchOnce({ success: false, data: null, message: "Knowledge k-1 not found", code: "NOT_FOUND" }, false, 404);
    await expect(getKnowledgeArticle("k-1")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
