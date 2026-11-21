import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDiscussion, getDiscussion, getDiscussions } from "@/lib/api/discussions";

function mockFetch(body: unknown, ok = true, status = 200) {
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

describe("discussion API client", () => {
  it("lists discussions with the established pagination contract", async () => {
    mockFetch({
      success: true,
      data: { items: [], page: 1, limit: 20, total: 0, totalPages: 0 },
      message: "Discussions retrieved",
    });

    await getDiscussions({ page: 1, limit: 20 });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/discussions?page=1&limit=20",
      expect.anything(),
    );
  });

  it("reads a single public discussion by id", async () => {
    mockFetch({
      success: true,
      data: {
        _id: "d-1",
        title: "Question",
        body: "Body",
        category: "QUESTION",
        status: "ACTIVE",
        author: { _id: "u-1", name: "Author", role: "USER" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      message: "Discussion retrieved",
    });

    const result = await getDiscussion("d-1");

    expect(result._id).toBe("d-1");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.aquaveda.com/api/v1/discussions/d-1",
      expect.anything(),
    );
  });

  it("posts only the locked discussion fields", async () => {
    mockFetch({
      success: true,
      data: {
        _id: "d-1",
        title: "Question",
        body: "Body",
        category: "QUESTION",
        status: "ACTIVE",
        author: { _id: "u-1", name: "Author", role: "USER" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      message: "Discussion created",
    });

    await createDiscussion({
      title: "Question",
      body: "Body",
      category: "QUESTION",
    });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ title: "Question", body: "Body", category: "QUESTION" }),
    });
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });
});
