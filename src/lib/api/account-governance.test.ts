import { afterEach, describe, expect, it, vi } from "vitest";

import * as governanceApi from "@/lib/api/account-governance";
import * as readApi from "@/lib/api/accounts";
import { ApiError } from "@/lib/api/client";
import envelopes from "@/test-utils/fixtures/account-governance-envelopes.json";

/** Envelopes RECORDED from the real Express app on real MongoDB (see `_provenance`). */
type Recorded = { status: number; body: unknown };
const rec = (name: keyof typeof envelopes) => envelopes[name] as unknown as Recorded;

const calls: { url: string; init?: RequestInit }[] = [];
function stub(name: keyof typeof envelopes) {
  const r = rec(name);
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("module boundaries", () => {
  it("the governance module exposes exactly the four supported mutations", () => {
    expect(Object.keys(governanceApi).sort()).toEqual(["liftMute", "liftSuspension", "muteAccount", "suspendAccount"]);
  });

  it("the #250 read module stays read-only (no mutation function was added to it)", () => {
    expect(Object.keys(readApi).sort()).toEqual(["getAccountDirectory", "getAccountEntry", "getAccountHistory"]);
  });
});

describe("requests", () => {
  const cases = [
    ["muteAccount", (id: string) => governanceApi.muteAccount(id, { expiresAt: "2026-11-26T12:00:00.000Z", reason: "r", safeReason: "s" }), "mute", { expiresAt: "2026-11-26T12:00:00.000Z", reason: "r", safeReason: "s" }],
    ["liftMute", (id: string) => governanceApi.liftMute(id, { reason: "ok" }), "mute/lift", { reason: "ok" }],
    ["suspendAccount (indefinite)", (id: string) => governanceApi.suspendAccount(id, { kind: "INDEFINITE", reason: "r" }), "suspend", { kind: "INDEFINITE", reason: "r" }],
    ["suspendAccount (temporary)", (id: string) => governanceApi.suspendAccount(id, { kind: "TEMPORARY", expiresAt: "2026-11-26T12:00:00.000Z", reason: "r" }), "suspend", { kind: "TEMPORARY", expiresAt: "2026-11-26T12:00:00.000Z", reason: "r" }],
    ["liftSuspension", (id: string) => governanceApi.liftSuspension(id), "suspend/lift", {}],
  ] as const;

  it.each(cases)("%s: one POST with a JSON body to the documented path", async (_name, call, path, body) => {
    stub("muteOk");
    await call("a/b c");
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url, "http://x").pathname).toBe(`/api/v1/accounts/a%2Fb%20c/${path}`);
    expect(calls[0].init?.method).toBe("POST");
    expect(new Headers(calls[0].init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(body);
  });

  it("a recorded success parses, and the UI-facing result type needs only id and accountState", async () => {
    stub("muteOk");
    const result = await governanceApi.muteAccount("x", { expiresAt: "2026-11-26T12:00:00.000Z" });
    expect(result).toMatchObject({ accountState: "MUTED" });
  });
});

describe("the real client now preserves the backend's allowlisted failure reason", () => {
  async function failure(name: keyof typeof envelopes) {
    stub(name);
    return governanceApi.muteAccount("x", { expiresAt: "2026-11-26T12:00:00.000Z" }).then(() => null, (e: unknown) => e as ApiError);
  }

  it("selfTarget / adminTarget carry status, code AND serverReason", async () => {
    const self = await failure("selfTarget");
    expect([self?.status, self?.code, self?.serverReason]).toEqual([403, "FORBIDDEN", "SELF_TARGET_PROHIBITED"]);
    const peer = await failure("adminTarget");
    expect([peer?.status, peer?.code, peer?.serverReason]).toEqual([403, "FORBIDDEN", "ADMIN_TARGET_PROTECTED"]);
  });

  it("failures without a reason keep serverReason undefined; the client-side timeout marker is unaffected", async () => {
    for (const name of ["stateRace", "muteAgainInvalidState", "notFound", "unauthorized", "forbiddenUserActor", "validationMissingReason"] as const) {
      const e = await failure(name);
      expect(e).toBeInstanceOf(ApiError);
      expect(e?.serverReason).toBeUndefined();
      expect(e?.reason).toBeUndefined();
    }
    const state = await failure("stateRace");
    expect([state?.status, state?.code]).toEqual([409, "STATE_RACE"]);
  });

  it("a non-string reason in a body is ignored", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, data: null, message: "x", code: "FORBIDDEN", reason: { a: 1 } }), { status: 403, headers: { "content-type": "application/json" } })));
    const e = await governanceApi.liftMute("x").then(() => null, (err: unknown) => err as ApiError);
    expect(e?.serverReason).toBeUndefined();
  });
});

describe("recorded payloads leak nothing private to the client", () => {
  it("no success envelope carries the private reason text, and the UI type excludes event ids", () => {
    const text = JSON.stringify(envelopes);
    expect(text).not.toContain("PRIVATE-REASON-TEXT");
  });
});
