import { describe, it, expect, vi, afterEach } from "vitest";

import { apiRequest, ApiError } from "@/lib/api/client";

function mockFetchOnce(response: Partial<Response> & { jsonBody?: unknown; text?: string }) {
  const body = response.text ?? (response.jsonBody !== undefined ? JSON.stringify(response.jsonBody) : "");
  global.fetch = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => body,
    ...response,
  } as Response);
}

describe("apiRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the unwrapped data on a successful response", async () => {
    mockFetchOnce({ ok: true, status: 200, jsonBody: { success: true, data: { hello: "world" }, message: "ok" } });
    const result = await apiRequest<{ hello: string }>("/x");
    expect(result).toEqual({ hello: "world" });
  });

  it("always sends credentials: include", async () => {
    mockFetchOnce({ ok: true, jsonBody: { success: true, data: null, message: "ok" } });
    await apiRequest("/x");
    expect(global.fetch).toHaveBeenCalledWith(
      "/x",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("throws an ApiError with kind 'network' when fetch itself rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    await expect(apiRequest("/x")).rejects.toMatchObject({
      name: "ApiError",
      kind: "network",
    });
  });

  it("throws an ApiError with kind 'http', carrying status and code, for a success:false response", async () => {
    mockFetchOnce({
      ok: false,
      status: 404,
      jsonBody: { success: false, data: null, message: "Issue not found", code: "NOT_FOUND" },
    });
    await expect(apiRequest("/x")).rejects.toMatchObject({
      kind: "http",
      status: 404,
      code: "NOT_FOUND",
      message: "Issue not found",
    });
  });

  it("throws an ApiError with kind 'response' for a non-JSON content-type", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html></html>",
    } as Response);
    await expect(apiRequest("/x")).rejects.toMatchObject({ kind: "response" });
  });

  it("throws an ApiError with kind 'response' for an empty body", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "",
    } as Response);
    await expect(apiRequest("/x")).rejects.toMatchObject({ kind: "response" });
  });

  it("throws an ApiError with kind 'response' for malformed JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "{not valid json",
    } as Response);
    await expect(apiRequest("/x")).rejects.toMatchObject({ kind: "response" });
  });

  it("ApiError instances are real Error instances (instanceof works)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom"));
    try {
      await apiRequest("/x");
      expect.unreachable("apiRequest should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(Error);
    }
  });
});
