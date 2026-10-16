import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  applyForExpert,
  approveExpertApplication,
  getMyExpertApplication,
  getPendingExpertApplications,
  rejectExpertApplication,
} from "@/lib/api/expert-application";

function mockFetchOnce(data: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify({ success: true, data, message: "ok" }),
  } as Response);
}

const lastCall = () => {
  const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
  return { url: String(url), init: init as RequestInit };
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
});
afterEach(() => vi.restoreAllMocks());

describe("expert-application API wrappers", () => {
  it("applyForExpert: POST with NO body — no role, applicant, or status can be sent", async () => {
    mockFetchOnce({ status: "pending", history: [] });
    await applyForExpert();
    const { url, init } = lastCall();
    expect(url).toBe("https://api.aquaveda.com/api/v1/expert-application");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe("include");
  });

  it("getMyExpertApplication: GET /me, no user id anywhere", async () => {
    mockFetchOnce({ status: "none", history: [] });
    await getMyExpertApplication();
    const { url, init } = lastCall();
    expect(url).toBe("https://api.aquaveda.com/api/v1/expert-application/me");
    expect(init.method).toBeUndefined();
  });

  it("getPendingExpertApplications: GET with the page query", async () => {
    mockFetchOnce({ items: [], page: 2, limit: 20, total: 0, totalPages: 0 });
    await getPendingExpertApplications({ page: 2 });
    expect(lastCall().url).toBe("https://api.aquaveda.com/api/v1/expert-application?page=2");
  });

  it("approve: POST to the named applicant's approve route, no body", async () => {
    mockFetchOnce({ userId: "u1", status: "approved" });
    await approveExpertApplication("507f1f77bcf86cd799439011");
    const { url, init } = lastCall();
    expect(url).toBe("https://api.aquaveda.com/api/v1/expert-application/507f1f77bcf86cd799439011/approve");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("reject: sends only { note } when given, else an empty object — never a role/status", async () => {
    mockFetchOnce({ userId: "u1", status: "rejected" });
    await rejectExpertApplication("u1", "needs detail");
    expect(lastCall().url).toBe("https://api.aquaveda.com/api/v1/expert-application/u1/reject");
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ note: "needs detail" });
    expect(new Headers(lastCall().init.headers).get("Content-Type")).toBe("application/json");

    mockFetchOnce({ userId: "u1", status: "rejected" });
    await rejectExpertApplication("u1");
    expect(JSON.parse(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body))).toEqual({});
  });

  it("encodes the applicant id path segment", async () => {
    mockFetchOnce({ userId: "x", status: "approved" });
    await approveExpertApplication("a/b?c");
    expect(lastCall().url).toContain("/a%2Fb%3Fc/approve");
  });
});
