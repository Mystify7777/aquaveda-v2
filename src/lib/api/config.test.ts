import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { getApiBaseUrl, buildApiUrl } from "@/lib/api/config";

describe("getApiBaseUrl", () => {
  const original = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = original;
  });

  it("falls back to the local dev default when unset", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(getApiBaseUrl()).toBe("http://localhost:5000");
  });

  it("uses NEXT_PUBLIC_API_URL when set", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
    expect(getApiBaseUrl()).toBe("https://api.aquaveda.com");
  });

  it("strips a trailing slash", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com/";
    expect(getApiBaseUrl()).toBe("https://api.aquaveda.com");
  });
});

describe("buildApiUrl", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.aquaveda.com";
  });

  it("builds an absolute URL for a path with no query", () => {
    expect(buildApiUrl("/api/v1/issues")).toBe("https://api.aquaveda.com/api/v1/issues");
  });

  it("adds a leading slash if the path is missing one", () => {
    expect(buildApiUrl("api/v1/issues")).toBe("https://api.aquaveda.com/api/v1/issues");
  });

  it("serializes query parameters", () => {
    const url = buildApiUrl("/api/v1/issues", { status: "open", page: 2 });
    expect(url).toBe("https://api.aquaveda.com/api/v1/issues?status=open&page=2");
  });

  it("omits undefined and null query values rather than serializing them as strings", () => {
    const url = buildApiUrl("/api/v1/issues", { status: undefined, page: 1, limit: null });
    expect(url).toBe("https://api.aquaveda.com/api/v1/issues?page=1");
  });
});
