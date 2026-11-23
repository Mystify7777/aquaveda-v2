import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import envelopes from "@/test-utils/fixtures/auth-me-envelopes.json";

/** Envelopes RECORDED from the real Express app on real MongoDB (see `_provenance`). */
type Recorded = { status: number; contentType: string; body: unknown };

function stubMe(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  );
}
const recorded = (name: "active" | "muted" | "suspended" | "anonymous") => envelopes[name] as unknown as Recorded;

afterEach(() => vi.unstubAllGlobals());

describe("getCurrentUser parses the real /auth/me envelope", () => {
  it.each([
    ["active", "ACTIVE"],
    ["muted", "MUTED"],
    ["suspended", "HARD_SUSPENDED"],
  ] as const)("%s -> user with accountState %s", async (name, state) => {
    const r = recorded(name);
    expect(r.status).toBe(200);
    stubMe(r.body);
    const user = await getCurrentUser();
    expect(user).toEqual({ id: expect.any(String), role: "USER", accountState: state });
  });

  it("anonymous (user: null, accountState: null) -> null", async () => {
    stubMe(recorded("anonymous").body);
    expect(await getCurrentUser()).toBeNull();
  });

  it("legacy shape without accountState still parses (no restriction known)", async () => {
    stubMe({ success: true, data: { user: { id: "u1", role: "USER" } }, message: "OK" });
    expect(await getCurrentUser()).toEqual({ id: "u1", role: "USER" });
  });

  it("a non-string accountState is an unusable response, not a silent 'no restriction'", async () => {
    stubMe({ success: true, data: { user: { id: "u1", role: "USER" }, accountState: 7 }, message: "OK" });
    await expect(getCurrentUser()).rejects.toMatchObject({ kind: "response" });
    await expect(getCurrentUser()).rejects.toBeInstanceOf(ApiError);
  });

  it("an unusable user is still rejected as before", async () => {
    stubMe({ success: true, data: { user: { id: 1 }, accountState: "ACTIVE" }, message: "OK" });
    await expect(getCurrentUser()).rejects.toMatchObject({ kind: "response" });
  });
});
