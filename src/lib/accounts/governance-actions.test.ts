import { describe, expect, it } from "vitest";

import {
  ACTION_LABEL,
  DURATION_PRESETS,
  EMPTY_FIELDS,
  SUCCESS_MESSAGE,
  availableGovernanceActions,
  classifyGovernanceFailure,
  governanceProtection,
  resolveExpiry,
  validateGovernanceForm,
  type GovernanceFields,
} from "@/lib/accounts/governance-actions";
import { REASON_MAX_LENGTH, SAFE_REASON_MAX_LENGTH } from "@/lib/accounts/governance-contract";
import { ApiError } from "@/lib/api/client";
import envelopes from "@/test-utils/fixtures/account-governance-envelopes.json";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const fields = (over: Partial<GovernanceFields> = {}): GovernanceFields => ({ ...EMPTY_FIELDS, ...over });
const entry = (role: string, accountState: string, id = "t1") => ({ id, role: role as "USER", accountState });

describe("contract boundary", () => {
  it("the limits are the backend's own (re-exported, not copied)", () => {
    expect([REASON_MAX_LENGTH, SAFE_REASON_MAX_LENGTH]).toEqual([2000, 500]);
  });
});

describe("availableGovernanceActions (presentation, not authorization)", () => {
  it.each([
    ["USER", "ACTIVE", ["mute", "suspend"]],
    ["EXPERT", "ACTIVE", ["mute", "suspend"]],
    ["USER", "MUTED", ["liftMute"]],
    ["EXPERT", "HARD_SUSPENDED", ["liftSuspension"]],
    ["USER", "DELETION_PENDING", []],
    ["USER", "PERMANENTLY_DELETED", []],
    ["USER", "SOMETHING_NEW", []],
  ])("%s in %s -> %j (never contradictory actions)", (role, state, expected) => {
    expect(availableGovernanceActions(entry(role, state), "viewer")).toEqual(expected);
  });

  it("a MUTED account is never offered suspend, and a suspended one never mute (the backend requires ACTIVE)", () => {
    expect(availableGovernanceActions(entry("USER", "MUTED"), "viewer")).not.toContain("suspend");
    expect(availableGovernanceActions(entry("USER", "HARD_SUSPENDED"), "viewer")).not.toContain("mute");
  });

  it("ADMIN targets, the viewer's own account, unknown roles and an unknown viewer get nothing", () => {
    expect(availableGovernanceActions(entry("ADMIN", "ACTIVE"), "viewer")).toEqual([]);
    expect(availableGovernanceActions(entry("ADMIN", "MUTED"), "viewer")).toEqual([]);
    expect(availableGovernanceActions(entry("USER", "ACTIVE", "me"), "me")).toEqual([]);
    expect(availableGovernanceActions(entry("MODERATOR", "ACTIVE"), "viewer")).toEqual([]);
    expect(availableGovernanceActions(entry("USER", "ACTIVE"), undefined)).toEqual([]);
  });

  it("governanceProtection explains why (the operator-managed note)", () => {
    expect(governanceProtection({ id: "a", role: "ADMIN" }, "x")).toBe("admin");
    expect(governanceProtection({ id: "x", role: "USER" }, "x")).toBe("self");
    expect(governanceProtection({ id: "a", role: "USER" }, "x")).toBeNull();
    expect(ACTION_LABEL.liftMute).toBe("Lift mute");
  });
});

describe("resolveExpiry", () => {
  it.each(DURATION_PRESETS.map((p) => [p.id, p.ms] as const))("preset %s = now + its duration, computed from `now`", (id, ms) => {
    expect(resolveExpiry(id, "", NOW)).toEqual({ ok: true, expiresAt: new Date(NOW.getTime() + ms).toISOString() });
  });

  it("custom: valid future instant, past, empty, invalid", () => {
    const future = new Date(NOW.getTime() + 3_600_000);
    const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}T${String(future.getHours()).padStart(2, "0")}:${String(future.getMinutes()).padStart(2, "0")}`;
    expect(resolveExpiry("custom", local, NOW)).toMatchObject({ ok: true });
    expect(resolveExpiry("custom", "2020-01-01T00:00", NOW)).toEqual({ ok: false, message: "The end must be in the future." });
    expect(resolveExpiry("custom", "", NOW)).toEqual({ ok: false, message: "Choose an end date and time." });
    expect(resolveExpiry("custom", "not-a-date", NOW)).toEqual({ ok: false, message: "Enter a valid end date and time." });
  });
});

describe("validateGovernanceForm (the server stays authoritative)", () => {
  it("mute: exact body; blank reasons are omitted", () => {
    expect(validateGovernanceForm("mute", fields({ duration: "24h" }), NOW)).toEqual({
      ok: true,
      request: { action: "mute", input: { expiresAt: "2026-11-26T12:00:00.000Z" } },
    });
    expect(validateGovernanceForm("mute", fields({ duration: "1h", reason: "  spam  ", safeReason: " Be civil " }), NOW)).toEqual({
      ok: true,
      request: { action: "mute", input: { expiresAt: "2026-11-25T13:00:00.000Z", reason: "spam", safeReason: "Be civil" } },
    });
  });

  it("suspend REQUIRES a private reason (blank/whitespace rejected), mute and lifts do not", () => {
    for (const blank of ["", "   ", "\n\t"]) {
      expect(validateGovernanceForm("suspend", fields({ reason: blank }), NOW)).toEqual({
        ok: false,
        errors: { reason: "A private reason is required for a suspension." },
      });
    }
    expect(validateGovernanceForm("mute", fields({ reason: "" }), NOW).ok).toBe(true);
    expect(validateGovernanceForm("liftMute", fields(), NOW).ok).toBe(true);
    expect(validateGovernanceForm("liftSuspension", fields(), NOW).ok).toBe(true);
  });

  it("suspend: INDEFINITE carries no expiry; TEMPORARY requires a valid one (exact union bodies)", () => {
    expect(validateGovernanceForm("suspend", fields({ suspendKind: "INDEFINITE", reason: "abuse" }), NOW)).toEqual({
      ok: true,
      request: { action: "suspend", input: { kind: "INDEFINITE", reason: "abuse" } },
    });
    expect(validateGovernanceForm("suspend", fields({ suspendKind: "TEMPORARY", duration: "7d", reason: "abuse", safeReason: "Policy" }), NOW)).toEqual({
      ok: true,
      request: { action: "suspend", input: { kind: "TEMPORARY", expiresAt: "2026-12-02T12:00:00.000Z", reason: "abuse", safeReason: "Policy" } },
    });
    expect(validateGovernanceForm("suspend", fields({ suspendKind: "TEMPORARY", duration: "custom", customEnd: "", reason: "abuse" }), NOW)).toEqual({
      ok: false,
      errors: { duration: "Choose an end date and time." },
    });
  });

  it("an INDEFINITE suspension ignores a leftover duration choice (no stray expiresAt)", () => {
    const result = validateGovernanceForm("suspend", fields({ suspendKind: "INDEFINITE", duration: "custom", customEnd: "garbage", reason: "x" }), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.input).not.toHaveProperty("expiresAt");
  });

  it("enforces the backend's length limits on both text fields", () => {
    const tooLong = validateGovernanceForm("mute", fields({ reason: "x".repeat(2001), safeReason: "y".repeat(501) }), NOW);
    expect(tooLong).toEqual({
      ok: false,
      errors: { reason: "The reason can be at most 2000 characters.", safeReason: "The message can be at most 500 characters." },
    });
    expect(validateGovernanceForm("mute", fields({ reason: "x".repeat(2000), safeReason: "y".repeat(500) }), NOW).ok).toBe(true);
  });

  it("lifts send only the optional reason", () => {
    expect(validateGovernanceForm("liftMute", fields({ reason: " resolved " }), NOW)).toEqual({
      ok: true,
      request: { action: "liftMute", input: { reason: "resolved" } },
    });
    expect(validateGovernanceForm("liftSuspension", fields({ safeReason: "ignored" }), NOW)).toEqual({
      ok: true,
      request: { action: "liftSuspension", input: {} },
    });
  });
});

type Env = { status: number; body: { code?: string; message?: string; reason?: string } };
const fromEnvelope = (name: keyof typeof envelopes) => {
  const e = envelopes[name] as unknown as Env;
  return new ApiError(e.body.message ?? "", "http", e.status, e.body.code, undefined, e.body.reason);
};

describe("classifyGovernanceFailure (against the RECORDED real envelopes)", () => {
  it("ADR-0012 target rules: presented as authoritative, reconcile, close the dialog", () => {
    const self = classifyGovernanceFailure(fromEnvelope("selfTarget"));
    expect(self).toMatchObject({ kind: "protected", reconcile: true, closesDialog: true });
    expect(self.message).toBe("You can't change your own account's governance state.");
    const peer = classifyGovernanceFailure(fromEnvelope("adminTarget"));
    expect(peer).toMatchObject({ kind: "protected", reconcile: true, closesDialog: true });
    expect(peer.message).toBe("Administrator accounts are managed by operators and can't be changed here.");
  });

  it("STATE_RACE and INVALID_STATE: stale -> reconcile, never retry, and the server's 'reload and retry' text is NOT shown", () => {
    for (const name of ["stateRace", "muteAgainInvalidState", "liftNotMutedInvalidState"] as const) {
      const f = classifyGovernanceFailure(fromEnvelope(name));
      expect(f).toMatchObject({ kind: "stale", reconcile: true, closesDialog: true });
      expect(f.message).not.toMatch(/retry/i);
      expect(f.message).toContain("nothing was applied");
    }
  });

  it("404: not found, reconcile", () => {
    expect(classifyGovernanceFailure(fromEnvelope("notFound"))).toMatchObject({ kind: "not-found", reconcile: true, closesDialog: true });
  });

  it("400 validation: stays on the form with the server's field text, no reconcile", () => {
    const f = classifyGovernanceFailure(fromEnvelope("validationMissingReason"));
    expect(f).toMatchObject({ kind: "validation", reconcile: false, closesDialog: false });
    expect(f.message).toBe('Check the details and try again. The server said: "Required".');
  });

  it("401 and a generic 403 are safe and do not reconcile; no policy detail is invented", () => {
    expect(classifyGovernanceFailure(fromEnvelope("unauthorized"))).toMatchObject({ kind: "session", reconcile: false, closesDialog: false });
    const forbidden = classifyGovernanceFailure(fromEnvelope("forbiddenUserActor"));
    expect(forbidden).toMatchObject({ kind: "forbidden", reconcile: false, closesDialog: false });
    expect(forbidden.message).toBe("Your account is not permitted to change this account.");
  });

  it("an unknown outcome (network, timeout, 5xx, unusable response) reconciles instead of retrying", () => {
    for (const error of [
      new ApiError("x", "network"),
      new ApiError("Request timed out", "network", undefined, undefined, "timeout"),
      new ApiError("x", "response"),
      new ApiError("boom", "http", 500, "INTERNAL_ERROR"),
      new ApiError("x", "http", 503),
    ]) {
      expect(classifyGovernanceFailure(error)).toMatchObject({ kind: "unknown-outcome", reconcile: true, closesDialog: true });
    }
  });

  it("an account restriction on the ADMIN (#248) uses the shared restricted copy and does not reconcile", () => {
    const muted = classifyGovernanceFailure(new ApiError("x", "http", 403, "ACCOUNT_MUTED"));
    expect(muted).toMatchObject({ kind: "restricted", reconcile: false, closesDialog: false });
    expect(muted.message).toMatch(/muted/);
  });

  it("an unrecognized 4xx and a non-ApiError degrade to a generic, safe message", () => {
    expect(classifyGovernanceFailure(new ApiError("x", "http", 418, "TEAPOT"))).toMatchObject({ kind: "failed", reconcile: false });
    expect(classifyGovernanceFailure(new Error("secret internals"))).toMatchObject({ kind: "failed", message: "That action could not be completed. Try again." });
  });

  it("a 403 with an unlisted reason is a generic forbidden (the server reason must be one of the two documented)", () => {
    expect(classifyGovernanceFailure(new ApiError("x", "http", 403, "FORBIDDEN", undefined, "SOMETHING_ELSE")).kind).toBe("forbidden");
  });

  it("no failure message ever contains a server error body verbatim except the validation text", () => {
    for (const name of ["selfTarget", "adminTarget", "stateRace", "notFound", "unauthorized", "forbiddenUserActor"] as const) {
      const body = (envelopes[name] as unknown as Env).body;
      expect(classifyGovernanceFailure(fromEnvelope(name)).message).not.toContain(body.message ?? "\u0000");
    }
  });
});

describe("success messages", () => {
  it("name the account and the outcome", () => {
    expect(SUCCESS_MESSAGE.mute("Mira")).toBe("Mira was muted.");
    expect(SUCCESS_MESSAGE.suspend("Mira")).toBe("Mira was suspended.");
    expect(SUCCESS_MESSAGE.liftMute("Mira")).toBe("The mute on Mira was lifted.");
    expect(SUCCESS_MESSAGE.liftSuspension("Mira")).toBe("The suspension on Mira was lifted.");
  });
});
