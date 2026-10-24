import { describe, it, expect } from "vitest";

import { navIndicator, type NavIndicatorInput } from "@/lib/expert/nav-indicator";

const ready = (over: Partial<NavIndicatorInput> = {}): NavIndicatorInput => ({
  status: "ready",
  stale: false,
  application: null,
  pendingCount: null,
  ...over,
});
const app = (status: "none" | "pending" | "approved" | "rejected") => ({ status, history: [] });

describe("navIndicator", () => {
  it("USER: pending / approved / not approved; nothing before applying", () => {
    expect(navIndicator("USER", ready({ application: app("pending") }))?.text).toBe("Pending");
    expect(navIndicator("USER", ready({ application: app("approved") }))?.text).toBe("Approved");
    expect(navIndicator("USER", ready({ application: app("rejected") }))?.text).toBe("Not approved");
    expect(navIndicator("USER", ready({ application: app("none") }))).toBeNull();
  });

  it("ADMIN: pending count, hidden at zero, capped at 99+, singular/plural screen-reader text", () => {
    expect(navIndicator("ADMIN", ready({ pendingCount: 3 }))).toEqual({ text: "3", screenReaderText: "3 pending applications" });
    expect(navIndicator("ADMIN", ready({ pendingCount: 1 }))?.screenReaderText).toBe("1 pending application");
    expect(navIndicator("ADMIN", ready({ pendingCount: 0 }))).toBeNull();
    expect(navIndicator("ADMIN", ready({ pendingCount: 250 }))?.text).toBe("99+");
  });

  it("is neutral unless the status is READY and NOT stale (never stale data as current)", () => {
    for (const status of ["idle", "loading", "error"] as const) {
      expect(navIndicator("USER", ready({ status, application: app("pending") }))).toBeNull();
      expect(navIndicator("ADMIN", ready({ status, pendingCount: 5 }))).toBeNull();
    }
    expect(navIndicator("USER", ready({ stale: true, application: app("pending") }))).toBeNull();
    expect(navIndicator("ADMIN", ready({ stale: true, pendingCount: 5 }))).toBeNull();
  });

  it("EXPERT and unknown roles never get an indicator", () => {
    expect(navIndicator("EXPERT", ready({ application: app("approved"), pendingCount: 4 }))).toBeNull();
    expect(navIndicator(null, ready({ pendingCount: 4 }))).toBeNull();
  });
});
