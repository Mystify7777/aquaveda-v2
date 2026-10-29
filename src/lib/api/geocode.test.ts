import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { ApiError } from "@/lib/api/client";
import { searchLocations } from "@/lib/api/geocode";

function mockFetch(body: unknown, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
  } as Response);
}

describe("searchLocations", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs /api/v1/geocode/search with an encoded q, credentials and the abort signal", async () => {
    const data = { results: [{ label: "Patna", latitude: 1, longitude: 2 }], attribution: { text: "©", url: "https://x.test" } };
    mockFetch({ success: true, data, message: "ok" });
    const controller = new AbortController();
    await expect(searchLocations("MG Road & co", { signal: controller.signal })).resolves.toEqual(data);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toBe("https://api.aquaveda.com/api/v1/geocode/search?q=MG+Road+%26+co");
    expect(init).toMatchObject({ credentials: "include", signal: controller.signal });
  });

  it("surfaces the backend failure code and status", async () => {
    mockFetch({ success: false, message: "x", code: "GEOCODER_UNAVAILABLE" }, 503);
    await expect(searchLocations("Patna")).rejects.toMatchObject({ status: 503, code: "GEOCODER_UNAVAILABLE" });
    await expect(searchLocations("Patna")).rejects.toBeInstanceOf(ApiError);
  });
});
