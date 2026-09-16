import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getProjects, getProject } from "@/lib/api/projects";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
  } as Response);
}

const SAMPLE_PROJECT = {
  _id: "p-1",
  title: "Community pipe repair",
  description: "Coordinated repair effort",
  originIssue: "issue-1",
  creator: { _id: "user-1", name: "Creator", role: "USER" },
  contributors: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getProjects", () => {
  it("serializes the originIssue filter", async () => {
    mockFetchOnce({ success: true, data: { items: [], page: 1, limit: 20, total: 0, totalPages: 0 }, message: "ok" });
    await getProjects({ originIssue: "issue-1" });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/projects?originIssue=issue-1",
      expect.anything(),
    );
  });

  it("returns the parsed paginated response", async () => {
    mockFetchOnce({
      success: true,
      data: { items: [SAMPLE_PROJECT], page: 1, limit: 20, total: 1, totalPages: 1 },
      message: "ok",
    });
    const result = await getProjects();
    expect(result.items[0].title).toBe("Community pipe repair");
  });
});

describe("getProject", () => {
  it("returns the project on success", async () => {
    mockFetchOnce({ success: true, data: SAMPLE_PROJECT, message: "ok" });
    const result = await getProject("p-1");
    expect(result._id).toBe("p-1");
  });

  it("throws a 404 ApiError for a nonexistent project", async () => {
    mockFetchOnce({ success: false, data: null, message: "Project p-1 not found", code: "NOT_FOUND" }, false, 404);
    await expect(getProject("p-1")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
