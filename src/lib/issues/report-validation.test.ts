import { describe, it, expect } from "vitest";

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
});
