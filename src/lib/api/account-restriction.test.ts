import { afterEach, describe, expect, it, vi } from "vitest";

import { apiRequest, ApiError } from "@/lib/api/client";
import { getAccountRestriction, restrictedActionMessage } from "@/lib/api/account-restriction";
import { describeActionFailure } from "@/lib/issues/issue-actions";
import { toActionFailure } from "@/lib/knowledge/action-failure";
import { toExpertActionFailure } from "@/lib/expert/action-failure";
import { getAuthErrorMessage } from "@/components/auth/auth-error";
import { loadErrorMessage } from "@/components/ui/load-error";
import envelopes from "@/test-utils/fixtures/account-restriction-envelopes.json";

/**
 * The envelopes below were RECORDED from the real Express app on real MongoDB
 * (see `_provenance` in the fixture), not hand-written.
 */
type Recorded = { status: number; contentType: string; body: Record<string, unknown> };
const rec = (name: keyof typeof envelopes) => envelopes[name] as unknown as Recorded;

async function failWith(name: keyof typeof envelopes): Promise<ApiError> {
  const r = rec(name);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": r.contentType } }),
    ),
  );
  const error = await apiRequest("/api/v1/x").then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

afterEach(() => vi.unstubAllGlobals());

describe("recorded backend envelope (contract)", () => {
  it.each([
    ["muted", "ACCOUNT_MUTED"],
    ["suspended", "ACCOUNT_SUSPENDED"],
    ["suspendedWrite", "ACCOUNT_SUSPENDED"],
    ["suspendedLogin", "ACCOUNT_SUSPENDED"],
  ] as const)("%s: 403, success:false, data:null, code %s", (name, code) => {
    const r = rec(name);
    expect(r.status).toBe(403);
    expect(r.body.success).toBe(false);
    expect(r.body.data).toBeNull();
    expect(r.body.code).toBe(code);
    // No governance detail on the wire (GOV-M2 / GOV-S6): only the standard envelope keys.
    expect(Object.keys(r.body).sort()).toEqual(["code", "data", "message", "success"]);
  });

  it("the API client preserves `code` and `status` on the ApiError", async () => {
    const muted = await failWith("muted");
    expect([muted.kind, muted.status, muted.code]).toEqual(["http", 403, "ACCOUNT_MUTED"]);
    const suspended = await failWith("suspended");
    expect([suspended.kind, suspended.status, suspended.code]).toEqual(["http", 403, "ACCOUNT_SUSPENDED"]);
  });
});

describe("getAccountRestriction", () => {
  it("distinguishes ACCOUNT_MUTED and ACCOUNT_SUSPENDED from the real envelopes", async () => {
    expect(getAccountRestriction(await failWith("muted"))).toBe("muted");
    expect(getAccountRestriction(await failWith("suspended"))).toBe("suspended");
    expect(getAccountRestriction(await failWith("suspendedWrite"))).toBe("suspended");
    expect(getAccountRestriction(await failWith("suspendedLogin"))).toBe("suspended");
  });

  it("a generic 403 (FORBIDDEN) and a 401 are not restrictions", async () => {
    expect(getAccountRestriction(await failWith("genericForbidden"))).toBeNull();
    expect(getAccountRestriction(await failWith("unauthorized"))).toBeNull();
  });

  it("requires BOTH HTTP 403 and the exact code; everything else is null", () => {
    expect(getAccountRestriction(new ApiError("m", "http", 403))).toBeNull();
    expect(getAccountRestriction(new ApiError("m", "http", 401, "ACCOUNT_SUSPENDED"))).toBeNull();
    expect(getAccountRestriction(new ApiError("m", "http", 500, "ACCOUNT_MUTED"))).toBeNull();
    expect(getAccountRestriction(new ApiError("m", "network", 403, "ACCOUNT_MUTED"))).toBeNull();
    expect(getAccountRestriction(new ApiError("m", "http", 403, "account_muted"))).toBeNull();
    expect(getAccountRestriction(new ApiError("m", "http", 403, "toString"))).toBeNull();
    expect(getAccountRestriction(new Error("ACCOUNT_MUTED"))).toBeNull();
    expect(getAccountRestriction(null)).toBeNull();
    expect(getAccountRestriction(undefined)).toBeNull();
  });
});

describe("existing failure mappers: restriction copy, everything else unchanged", () => {
  const muted = () => failWith("muted");
  const suspended = () => failWith("suspended");

  it("restrictedActionMessage: state-specific, null otherwise, no backend text surfaced", async () => {
    const m = restrictedActionMessage(await muted())!;
    const s = restrictedActionMessage(await suspended())!;
    expect(m).toMatch(/muted/);
    expect(m).toMatch(/read and browse/);
    expect(s).toMatch(/suspended/);
    expect(s).toMatch(/Sign out/);
    for (const text of [m, s]) expect(text).not.toMatch(/temporarily restricted|access is suspended|reason|expires/i);
    expect(restrictedActionMessage(await failWith("genericForbidden"))).toBeNull();
  });

  it("loadErrorMessage: restriction copy; generic 403 / 401 / 500 / network unchanged", async () => {
    expect(loadErrorMessage(await muted(), "things")).toMatch(/muted/);
    expect(loadErrorMessage(await suspended(), "things")).toMatch(/suspended/);
    expect(loadErrorMessage(await failWith("genericForbidden"), "things")).toBe("Your account is not permitted to view things.");
    expect(loadErrorMessage(await failWith("unauthorized"), "things")).toMatch(/session is no longer valid/);
    expect(loadErrorMessage(new ApiError("x", "http", 500), "things")).toBe("We could not load things. Try again.");
    expect(loadErrorMessage(new ApiError("x", "network"), "things")).toMatch(/unreachable/);
  });

  it("issue lifecycle actions: restriction message without reload; generic 403 still reloads", async () => {
    const m = describeActionFailure(await muted());
    expect(m.message).toMatch(/muted/);
    expect([m.reload, m.refresh, m.signIn]).toEqual([false, false, false]);
    const generic = describeActionFailure(await failWith("genericForbidden"));
    expect(generic.message).toBe("You no longer have permission to perform this action.");
    expect(generic.reload).toBe(true);
    expect(describeActionFailure(await failWith("unauthorized")).signIn).toBe(true);
  });

  it("knowledge and expert actions: restriction message; generic 403 / 401 unchanged", async () => {
    expect(toActionFailure(await suspended(), "review")).toEqual({ kind: "other", message: expect.stringMatching(/suspended/) });
    expect(toActionFailure(await failWith("genericForbidden"), "review").message).toBe("Your account is not permitted to review this article.");
    expect(toActionFailure(await failWith("unauthorized"), "review").kind).toBe("session");
    expect(toExpertActionFailure(await muted(), "apply")).toEqual({ kind: "other", message: expect.stringMatching(/muted/) });
    expect(toExpertActionFailure(await failWith("genericForbidden"), "apply").message).toBe("Only member accounts can apply for Expert status.");
    expect(toExpertActionFailure(await failWith("unauthorized"), "decide").kind).toBe("session");
  });

  it("login: suspended gets a specific message; other failures unchanged", async () => {
    expect(getAuthErrorMessage(await failWith("suspendedLogin"))).toMatch(/suspended/);
    expect(getAuthErrorMessage(new ApiError("m", "http", 401, "INVALID_CREDENTIALS"))).toBe("We could not sign you in with those details.");
    expect(getAuthErrorMessage(new ApiError("m", "network"))).toMatch(/unavailable/);
    expect(getAuthErrorMessage(await failWith("genericForbidden"))).toBe("We could not complete that request. Try again.");
  });
});
