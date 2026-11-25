import { afterEach, describe, expect, it, vi } from "vitest";

import * as accountsApi from "@/lib/api/accounts";
import { getAccountDirectory, getAccountEntry, getAccountHistory } from "@/lib/api/accounts";
import { ApiError } from "@/lib/api/client";
import envelopes from "@/test-utils/fixtures/account-directory-envelopes.json";

/** Envelopes RECORDED from the real Express app on real MongoDB (see `_provenance`). */
type Recorded = { status: number; body: unknown };
const rec = (name: keyof typeof envelopes) => envelopes[name] as unknown as Recorded;

const urls: string[] = [];
function stub(name: keyof typeof envelopes) {
  const r = rec(name);
  urls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      expect(init?.method ?? "GET").toBe("GET");
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("accounts API (read-only)", () => {
  it("exports only the three read functions: no mutation surface", () => {
    expect(Object.keys(accountsApi).sort()).toEqual(["getAccountDirectory", "getAccountEntry", "getAccountHistory"]);
  });

  it("directory: sends exactly the backend parameters and parses the recorded page", async () => {
    stub("directory");
    const page = await getAccountDirectory({ page: 2, role: "USER", accountState: "MUTED", q: "mira" });
    const url = new URL(urls[0], "http://x");
    expect(url.pathname).toBe("/api/v1/accounts");
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: "2", role: "USER", accountState: "MUTED", q: "mira" });
    expect(page.total).toBe(9);
    expect(page.items[0]).toHaveProperty("accountState");
  });

  it("directory: no parameters other than those supplied", async () => {
    stub("directory");
    await getAccountDirectory({ page: 1 });
    expect([...new URL(urls[0], "http://x").searchParams.keys()]).toEqual(["page"]);
  });

  it("entry and history: encoded id paths", async () => {
    stub("detailMuted");
    await getAccountEntry("a/b c");
    expect(new URL(urls[0], "http://x").pathname).toBe("/api/v1/accounts/a%2Fb%20c");
    stub("history");
    await getAccountHistory("abc", { page: 3 });
    const url = new URL(urls[0], "http://x");
    expect(url.pathname).toBe("/api/v1/accounts/abc/history");
    expect(url.searchParams.get("page")).toBe("3");
  });

  it.each([
    ["forbiddenUser", 403, "FORBIDDEN"],
    ["forbiddenExpert", 403, "FORBIDDEN"],
    ["unauthorized", 401, "UNAUTHORIZED"],
    ["directoryBadQuery", 400, "VALIDATION_FAILED"],
  ] as const)("%s -> ApiError %i %s from the recorded envelope", async (name, status, code) => {
    stub(name);
    const error = await getAccountDirectory({ page: 1 }).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect([(error as ApiError).status, (error as ApiError).code]).toEqual([status, code]);
  });

  it("detail not found / malformed id keep their statuses", async () => {
    stub("detailMissing");
    expect(await getAccountEntry("x").catch((e: ApiError) => e.status)).toBe(404);
    stub("detailMalformed");
    expect(await getAccountEntry("x").catch((e: ApiError) => e.status)).toBe(400);
  });

  it("the recorded payloads contain none of the fields the API deliberately excludes", () => {
    const text = JSON.stringify(envelopes);
    for (const banned of ["passwordHash", "authGeneration", "accountStateVersion", "expertApplication", "idempotencyKey", "references", "PRIVATE-REASON", "\"reason\""]) {
      expect(text).not.toContain(banned);
    }
  });
});
