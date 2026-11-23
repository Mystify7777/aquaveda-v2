import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { AuthProvider, useAuth } from "@/components/providers/auth-provider";
import envelopes from "@/test-utils/fixtures/auth-me-envelopes.json";

/**
 * Real AuthProvider + real auth-state + real API client; only `fetch` is stubbed.
 * `/auth/me` bodies are the envelopes RECORDED from the real backend (#251).
 */
type Recorded = { status: number; body: unknown };
const me = (name: keyof typeof envelopes) => envelopes[name] as unknown as Recorded;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fail = (status: number, code: string) => json(status, { success: false, data: null, message: code, code });

type Handler = () => Response | Promise<Response>;
let routes: Record<string, Handler>;
const calls: string[] = [];

beforeEach(() => {
  routes = {};
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://x").pathname.replace("/api/v1/auth", "");
      calls.push(path);
      const handler = routes[path];
      if (!handler) throw new Error(`unrouted ${path}`);
      return handler();
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

let ctx: ReturnType<typeof useAuth>;
function Probe() {
  const value = useAuth();
  React.useEffect(() => { ctx = value; });
  return (
    <p data-testid="s">
      {value.status}|{value.user?.role ?? "-"}|{value.restriction ?? "-"}
    </p>
  );
}
const mount = () => render(<AuthProvider><Probe /></AuthProvider>);
const state = () => screen.getByTestId("s").textContent;
const settled = () => waitFor(() => expect(state()).not.toMatch(/^initializing/));

describe("AuthProvider session bootstrap and account state", () => {
  it("active: authenticated, no restriction", async () => {
    routes["/me"] = () => json(200, me("active").body);
    mount();
    await settled();
    expect(state()).toBe("authenticated|USER|-");
  });

  it("MUTED: stays authenticated (not logged out), restriction muted, user kept", async () => {
    routes["/me"] = () => json(200, me("muted").body);
    mount();
    await settled();
    expect(state()).toBe("authenticated|USER|muted");
    expect(ctx.user?.accountState).toBe("MUTED");
  });

  it("HARD_SUSPENDED: status suspended, NO user, restriction suspended, before any other request", async () => {
    routes["/me"] = () => json(200, me("suspended").body);
    mount();
    await settled();
    expect(state()).toBe("suspended|-|suspended");
    expect(ctx.user).toBeNull();
    expect(calls).toEqual(["/me"]); // no refresh, nothing else needed to discover it
  });

  it("anonymous: /me null + refresh rejected -> anonymous", async () => {
    routes["/me"] = () => json(200, me("anonymous").body);
    routes["/refresh"] = () => fail(401, "REFRESH_FAILED");
    mount();
    await settled();
    expect(state()).toBe("anonymous|-|-");
  });

  it("refresh answering ACCOUNT_SUSPENDED -> suspended", async () => {
    routes["/me"] = () => json(200, me("anonymous").body);
    routes["/refresh"] = () => fail(403, "ACCOUNT_SUSPENDED");
    mount();
    await settled();
    expect(state()).toBe("suspended|-|suspended");
  });

  it("refresh success: account state is learned from /me (muted)", async () => {
    let meCalls = 0;
    routes["/me"] = () => (++meCalls === 1 ? json(200, me("anonymous").body) : json(200, me("muted").body));
    routes["/refresh"] = () => json(200, { success: true, data: { user: { id: "u1", role: "USER" } }, message: "OK" });
    mount();
    await settled();
    expect(state()).toBe("authenticated|USER|muted");
  });

  it("session failure (/me 500) is unchanged", async () => {
    routes["/me"] = () => fail(500, "INTERNAL_ERROR");
    mount();
    await settled();
    expect(state()).toBe("session-failure|-|-");
  });

  it("unavailable (network) is unchanged: retried, then unavailable", async () => {
    vi.useFakeTimers();
    try {
      routes["/me"] = () => { throw new TypeError("Failed to fetch"); };
      mount();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(state()).toBe("unavailable|-|-");
      expect(calls.filter((c) => c === "/me")).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logout from a suspended session clears the restriction and becomes anonymous", async () => {
    routes["/me"] = () => json(200, me("suspended").body);
    routes["/logout"] = () => json(200, { success: true, data: null, message: "Logged out" });
    mount();
    await settled();
    await act(async () => { await ctx.logout(); });
    expect(state()).toBe("anonymous|-|-");
  });

  it("login of a muted account: state learned from /me, session stays authenticated", async () => {
    routes["/me"] = () => json(200, me("anonymous").body);
    routes["/refresh"] = () => fail(401, "REFRESH_FAILED");
    routes["/login"] = () => json(200, { success: true, data: { user: { id: "u1", role: "USER" } }, message: "OK" });
    mount();
    await settled();
    routes["/me"] = () => json(200, me("muted").body);
    await act(async () => { await ctx.login({ email: "a@example.test", password: "x" }); });
    expect(state()).toBe("authenticated|USER|muted");
  });

  it("login: a failing /me follow-up never blocks sign-in", async () => {
    routes["/me"] = () => json(200, me("anonymous").body);
    routes["/refresh"] = () => fail(401, "REFRESH_FAILED");
    routes["/login"] = () => json(200, { success: true, data: { user: { id: "u1", role: "USER" } }, message: "OK" });
    mount();
    await settled();
    routes["/me"] = () => fail(500, "INTERNAL_ERROR");
    await act(async () => { await ctx.login({ email: "a@example.test", password: "x" }); });
    expect(state()).toBe("authenticated|USER|-");
  });

  it("refreshUser re-reads /me and applies a newly suspended state", async () => {
    routes["/me"] = () => json(200, me("active").body);
    mount();
    await settled();
    routes["/me"] = () => json(200, me("suspended").body);
    let result: unknown = "unset";
    await act(async () => { result = await ctx.refreshUser(); });
    expect(result).toBeNull();
    expect(state()).toBe("suspended|-|suspended");
  });
});
