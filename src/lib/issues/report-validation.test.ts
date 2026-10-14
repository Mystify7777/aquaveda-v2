import { describe, it, expect } from "vitest";

import { ISSUE_CATEGORIES, ISSUE_SEVERITIES } from "@/lib/issues/classification";
import { EMPTY_ISSUE_REPORT, validateIssueReport } from "@/lib/issues/report-validation";

const valid = { ...EMPTY_ISSUE_REPORT, title: " Leak ", description: "Pipe burst", latitude: "12.9", longitude: "77.5" };

describe("validateIssueReport", () => {
  it("builds a trimmed payload in GeoJSON [lon, lat] order", () => {
    const r = validateIssueReport(valid);
    expect(r).toEqual({
      ok: true,
      payload: { title: "Leak", description: "Pipe burst", location: { type: "Point", coordinates: [77.5, 12.9] } },
    });
  });

  it("flags required fields", () => {
    const r = validateIssueReport(EMPTY_ISSUE_REPORT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["description", "latitude", "longitude", "title"]);
  });

  it("rejects whitespace-only text, non-numeric and out-of-range coordinates", () => {
    const r = validateIssueReport({ ...valid, title: "  ", latitude: "91", longitude: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.title).toBeDefined();
      expect(r.errors.latitude).toMatch(/between/);
      expect(r.errors.longitude).toMatch(/number/);
    }
  });
  it("omits category/severity when unselected", () => {
    const r = validateIssueReport(valid);
    expect(r.ok && r.payload).not.toHaveProperty("category");
    expect(r.ok && r.payload).not.toHaveProperty("severity");
  });

  it("includes every canonical category and severity in the payload", () => {
    for (const c of ISSUE_CATEGORIES) {
      const r = validateIssueReport({ ...valid, category: c.value });
      expect(r.ok && r.payload.category).toBe(c.value);
    }
    for (const s of ISSUE_SEVERITIES) {
      const r = validateIssueReport({ ...valid, severity: s.value });
      expect(r.ok && r.payload.severity).toBe(s.value);
    }
  });

  it("rejects non-canonical category/severity", () => {
    const r = validateIssueReport({ ...valid, category: "infrastructure", severity: "urgent" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.category).toBeDefined();
      expect(r.errors.severity).toBeDefined();
    }
  });
});
