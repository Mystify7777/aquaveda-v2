import { describe, expect, it } from "vitest";

import {
  actionLabel,
  deletionSummary,
  restrictionSummary,
  roleLabel,
  stateLabel,
  stateTone,
  transitionStateLabel,
} from "@/lib/accounts/presentation";

describe("labels", () => {
  it("covers every account state, role and governance action; unknown values degrade safely", () => {
    expect(stateLabel("HARD_SUSPENDED")).toBe("Suspended");
    expect(stateLabel("DELETION_PENDING")).toBe("Deletion pending");
    expect(roleLabel("ADMIN")).toBe("Admin");
    expect(actionLabel("MUTE_LIFTED")).toBe("Mute lifted");
    expect(actionLabel("EXPERT_REVOKED")).toBe("Expert status revoked");
    expect(actionLabel("SOMETHING_NEW")).toBe("Something new");
    expect(stateLabel("toString")).toBe("Tostring"); // no prototype-key lookups
    expect(transitionStateLabel("EXPERT")).toBe("Expert");
    expect(transitionStateLabel("MUTED")).toBe("Muted");
  });

  it("state tone never relies on a single unknown default", () => {
    expect(stateTone("ACTIVE")).toBe("verified");
    expect(stateTone("MUTED")).toBe("warning");
    expect(stateTone("HARD_SUSPENDED")).toBe("critical");
    expect(stateTone("PERMANENTLY_DELETED")).toBe("outline");
  });
});

describe("restrictionSummary / deletionSummary", () => {
  it("null when unrestricted", () => {
    expect(restrictionSummary(null)).toBeNull();
    expect(deletionSummary({ deletionPending: false, deletionRequestedAt: null })).toBeNull();
  });

  it("indefinite, temporary and lapsed", () => {
    expect(restrictionSummary({ kind: "INDEFINITE", expiresAt: null, safeReason: null, lapsed: false })).toBe("No end date");
    expect(restrictionSummary({ kind: "TEMPORARY", expiresAt: "2026-11-24T07:29:00.000Z", safeReason: null, lapsed: false })).toBe(
      "Until Nov 24, 2026, 7:29 AM UTC",
    );
    expect(restrictionSummary({ kind: "TEMPORARY", expiresAt: "2026-11-24T05:28:00.000Z", safeReason: null, lapsed: true })).toBe(
      "Expired Nov 24, 2026, 5:28 AM UTC; not yet lifted",
    );
  });

  it("deletion pending with and without a timestamp", () => {
    expect(deletionSummary({ deletionPending: true, deletionRequestedAt: "2026-11-23T10:00:00.000Z" })).toBe("Deletion requested Nov 23, 2026");
    expect(deletionSummary({ deletionPending: true, deletionRequestedAt: null })).toBe("Deletion pending");
  });
});
