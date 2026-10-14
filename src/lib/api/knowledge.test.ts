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

describe("createKnowledge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs exactly the JSON payload with content-type to /api/v1/knowledge", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
    mockFetchOnce(
      { success: true, data: { _id: "k-2", title: "T", status: "draft" }, message: "Knowledge draft created" },
      true,
      201,
    );
    const { createKnowledge } = await import("@/lib/api/knowledge");
    await expect(createKnowledge({ title: "T", body: "B" })).resolves.toMatchObject({ _id: "k-2", status: "draft" });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/api/v1/knowledge");
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ title: "T", body: "B" }),
    });
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });
});

describe("submitKnowledge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /api/v1/knowledge/:id/submit with no body", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
    mockFetchOnce(
      { success: true, data: { _id: "k-2", title: "T", status: "pending_review" }, message: "Knowledge submitted for review" },
    );
    const { submitKnowledge } = await import("@/lib/api/knowledge");
    await expect(submitKnowledge("k-2")).resolves.toMatchObject({ status: "pending_review" });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.aquaveda.com/api/v1/knowledge/k-2/submit");
    expect(init).toMatchObject({ method: "POST" });
    expect(init.body).toBeUndefined();
  });
});

describe("authenticated workflow reads (#74)", () => {
  const envelope = (data: unknown) => ({ success: true, data, message: "ok" });
  const page = { items: [], page: 1, limit: 20, total: 0, totalPages: 0 };

  it("getMyKnowledge requests /mine with page and status, no author parameter", async () => {
    mockFetchOnce(envelope(page));
    const { getMyKnowledge } = await import("@/lib/api/knowledge");
    await getMyKnowledge({ page: 2, status: "rejected" });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.aquaveda.com/api/v1/knowledge/mine?page=2&status=rejected");
    expect(init).toMatchObject({ credentials: "include", cache: "no-store" });
  });

  it("getMyKnowledge omits an undefined status", async () => {
    mockFetchOnce(envelope(page));
    const { getMyKnowledge } = await import("@/lib/api/knowledge");
    await getMyKnowledge({ page: 1, status: undefined });
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://api.aquaveda.com/api/v1/knowledge/mine?page=1",
    );
  });

  it("getReviewQueue requests /review-queue with pagination only", async () => {
    mockFetchOnce(envelope(page));
    const { getReviewQueue } = await import("@/lib/api/knowledge");
    await getReviewQueue({ page: 3 });
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://api.aquaveda.com/api/v1/knowledge/review-queue?page=3",
    );
  });

  it("getKnowledgeWorkflow requests /:id/workflow, encoding the id", async () => {
    mockFetchOnce(envelope({ _id: "k-1" }));
    const { getKnowledgeWorkflow } = await import("@/lib/api/knowledge");
    await getKnowledgeWorkflow("k/1");
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://api.aquaveda.com/api/v1/knowledge/k%2F1/workflow",
    );
  });
});

describe("lifecycle writes", () => {
  const result = { success: true, data: { _id: "k-1", title: "T", status: "approved" }, message: "ok" };

  it("approveKnowledge POSTs /:id/approve with no body", async () => {
    mockFetchOnce(result);
    const { approveKnowledge } = await import("@/lib/api/knowledge");
    await approveKnowledge("k-1");
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.aquaveda.com/api/v1/knowledge/k-1/approve");
    expect(init).toMatchObject({ method: "POST" });
    expect(init.body).toBeUndefined();
  });

  it("rejectKnowledge POSTs exactly { feedback } as JSON", async () => {
    mockFetchOnce(result);
    const { rejectKnowledge } = await import("@/lib/api/knowledge");
    await rejectKnowledge("k-1", "needs sources");
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.aquaveda.com/api/v1/knowledge/k-1/reject");
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ feedback: "needs sources" }),
    });
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("reviseKnowledge POSTs exactly { title, body } as JSON", async () => {
    mockFetchOnce(result);
    const { reviseKnowledge } = await import("@/lib/api/knowledge");
    await reviseKnowledge("k-1", { title: "T2", body: "B2" });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.aquaveda.com/api/v1/knowledge/k-1/revise");
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ title: "T2", body: "B2" }),
    });
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });
});
