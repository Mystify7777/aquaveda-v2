import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getIssues, getIssue } from "@/lib/api/issues";
import { ApiError } from "@/lib/api/client";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
  } as Response);
}

const SAMPLE_ISSUE = {
  _id: "issue-1",
  title: "Leaking pipe",
  description: "Water pooling near the market",
  location: { type: "Point", coordinates: [77.5, 12.9] },
  severity: "",
  category: "",
  domain: "water",
  status: "open",
  reportedBy: { _id: "user-1", name: "Reporter", role: "USER" },
  statusHistory: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("getIssues", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the correct absolute URL with no query params by default", async () => {
    mockFetchOnce({ success: true, data: { items: [], page: 1, limit: 20, total: 0, totalPages: 0 }, message: "ok" });
    await getIssues();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/issues",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("serializes the status filter and pagination params into the query string", async () => {
    mockFetchOnce({ success: true, data: { items: [], page: 2, limit: 10, total: 0, totalPages: 0 }, message: "ok" });
    await getIssues({ status: "acknowledged", page: 2, limit: 10 });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/issues?status=acknowledged&page=2&limit=10",
      expect.anything(),
    );
  });

  it("returns the parsed paginated response, typed and unwrapped from the envelope", async () => {
    mockFetchOnce({
      success: true,
      data: { items: [SAMPLE_ISSUE], page: 1, limit: 20, total: 1, totalPages: 1 },
      message: "Issues retrieved",
    });
    const result = await getIssues();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Leaking pipe");
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it("propagates a backend error as an ApiError with its code intact", async () => {
    mockFetchOnce(
      { success: false, data: null, message: "\"bad\" is not a recognized Issue status", code: "VALIDATION_FAILED" },
      false,
      400,
    );
    await expect(getIssues({ status: "bad" as never })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });
  });

  it("propagates a network failure as an ApiError with kind 'network'", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("DNS lookup failed"));
    await expect(getIssues()).rejects.toBeInstanceOf(ApiError);
    await expect(getIssues()).rejects.toMatchObject({ kind: "network" });
  });
});

describe("getIssue", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the correct absolute URL for a single Issue", async () => {
    mockFetchOnce({ success: true, data: SAMPLE_ISSUE, message: "ok" });
    await getIssue("issue-1");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/issues/issue-1",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("returns the Issue on success", async () => {
    mockFetchOnce({ success: true, data: SAMPLE_ISSUE, message: "ok" });
    const result = await getIssue("issue-1");
    expect(result._id).toBe("issue-1");
  });

  it("throws a 404 ApiError for a nonexistent Issue", async () => {
    mockFetchOnce({ success: false, data: null, message: "Issue x not found", code: "NOT_FOUND" }, false, 404);
    await expect(getIssue("x")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
