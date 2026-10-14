import { describe, expect, it } from "vitest";

import {
  bboxToBounds,
  exploreHref,
  filterParams,
  hasNonCanonicalFilterParams,
  hasDiscoveryFilters,
  parseExploreQuery,
  toIssueListQuery,
  viewportToBbox,
  withoutDiscoveryFilters,
} from "@/lib/issues/discovery";

const BBOX = "77.5,12.8,77.7,13.1";

describe("parseExploreQuery", () => {
  it("no params -> no filters, nothing invalid", () => {
    expect(parseExploreQuery({})).toEqual({ filters: {}, invalid: {} });
  });

  it("reads every supported filter", () => {
    const { filters, invalid } = parseExploreQuery({
      status: "open", category: "leakage_wastage", severity: "high", q: "main road", bbox: BBOX,
    });
    expect(filters).toEqual({ status: "open", category: "leakage_wastage", severity: "high", q: "main road", bbox: BBOX });
    expect(invalid).toEqual({});
  });

  it("uses the first value of a repeated param", () => {
    expect(parseExploreQuery({ q: ["leak", "pump"] }).filters.q).toBe("leak");
  });

  it("trims q; blank values are inactive, not invalid", () => {
    expect(parseExploreQuery({ q: "  leak  " }).filters.q).toBe("leak");
    expect(parseExploreQuery({ q: "   ", category: "", bbox: "" })).toEqual({ filters: {}, invalid: {} });
  });

  it.each([["category", "nope"], ["category", "LEAKAGE_WASTAGE"], ["severity", "extreme"], ["status", "closed"]])(
    "unrecognized %s=%s is ignored, as status always was",
    (key, value) => {
      expect(parseExploreQuery({ [key]: value })).toEqual({ filters: {}, invalid: {} });
    },
  );

  it.each([["a"], ["x".repeat(101)], ["a b c d e f g h i j k"]])("q violating the contract is reported with the backend's wording: %s", (q) => {
    const { filters, invalid } = parseExploreQuery({ q });
    expect(filters.q).toBeUndefined();
    expect(invalid.q?.problem).toMatch(/^q must /);
  });

  it.each([
    ["1,2,3"],
    ["a,b,c,d"],
    ["-181,0,0,1"],
    ["0,-86,1,0"],
    ["5,0,5,1"],
    ["0,0,11,1"],
    ["0,0,1,11"],
  ])("bbox violating the contract is reported, never forwarded: %s", (bbox) => {
    const { filters, invalid } = parseExploreQuery({ bbox });
    expect(filters.bbox).toBeUndefined();
    expect(invalid.bbox?.problem).toMatch(/^bbox /);
  });

  it("keeps a valid bbox string exactly as written", () => {
    expect(parseExploreQuery({ bbox: "77.50,12.8,77.7,13.1" }).filters.bbox).toBe("77.50,12.8,77.7,13.1");
  });
});

describe("serialization", () => {
  const all = { status: "open", category: "leakage_wastage", severity: "high", q: "main road", bbox: BBOX } as const;

  it("omits inactive filters and page 1", () => {
    expect(exploreHref({})).toBe("/explore");
    expect(exploreHref({ status: "open" })).toBe("/explore?status=open");
    expect(exploreHref({}, 1)).toBe("/explore");
  });

  it("is deterministic regardless of insertion order", () => {
    const shuffled = { bbox: BBOX, q: "main road", severity: "high", category: "leakage_wastage", status: "open" } as const;
    expect(exploreHref(shuffled, 3)).toBe(exploreHref(all, 3));
    expect(exploreHref(all, 3)).toBe(
      "/explore?status=open&category=leakage_wastage&severity=high&q=main+road&bbox=77.5%2C12.8%2C77.7%2C13.1&page=3",
    );
    expect(Object.keys(filterParams(shuffled))).toEqual(["status", "category", "severity", "q", "bbox"]);
  });

  it("round-trips: parse(serialize(state)) === state, including special characters", () => {
    const state = { category: "leakage_wastage", q: "50% a.c & \"pump\"" } as const;
    const url = new URL(exploreHref(state, 2), "http://x");
    const sp = Object.fromEntries(url.searchParams);
    expect(parseExploreQuery(sp).filters).toEqual(state);
    expect(sp.page).toBe("2");
  });

  it("API query contains only active params, with page", () => {
    expect(toIssueListQuery({}, 1)).toEqual({ page: 1 });
    expect(Object.keys(toIssueListQuery({ status: "open" }, 2)).sort()).toEqual(["page", "status"]);
    expect(toIssueListQuery(all, 4)).toEqual({ page: 4, ...all });
  });
});

describe("helpers", () => {
  it("hasDiscoveryFilters ignores status", () => {
    expect(hasDiscoveryFilters({ status: "open" })).toBe(false);
    expect(hasDiscoveryFilters({ q: "leak" })).toBe(true);
    expect(hasDiscoveryFilters({ bbox: BBOX })).toBe(true);
  });

  it("withoutDiscoveryFilters keeps only status", () => {
    expect(withoutDiscoveryFilters({ status: "open", q: "leak", bbox: BBOX })).toEqual({ status: "open" });
    expect(withoutDiscoveryFilters({ q: "leak" })).toEqual({});
  });

  it("hasNonCanonicalFilterParams detects blank (native GET form) and whitespace-padded params", () => {
    expect(hasNonCanonicalFilterParams({ q: "", category: "" })).toBe(true);
    expect(hasNonCanonicalFilterParams({ q: " leak " })).toBe(true);
    expect(hasNonCanonicalFilterParams({ q: "leak", category: "leakage_wastage" })).toBe(false);
    expect(hasNonCanonicalFilterParams({ status: "", page: "" })).toBe(false); // existing params untouched
    expect(hasNonCanonicalFilterParams({})).toBe(false);
  });

  it("bboxToBounds", () => {
    expect(bboxToBounds(BBOX)).toEqual([77.5, 12.8, 77.7, 13.1]);
    expect(bboxToBounds("0,0,50,1")).toBeNull();
    expect(bboxToBounds(undefined)).toBeNull();
  });
});

describe("viewportToBbox (Leaflet bounds -> contract bbox)", () => {
  it("rounds to 5 decimals and validates with the backend rules", () => {
    expect(viewportToBbox([77.123456789, 12.000004, 77.5, 12.5])).toEqual({ ok: true, bbox: "77.12346,12,77.5,12.5" });
    expect(viewportToBbox([-0.000001, 0, 1, 1])).toEqual({ ok: true, bbox: "0,0,1,1" });
  });

  it("accepts exactly the 10 degree limit, rejects above it, never clamps", () => {
    expect(viewportToBbox([0, 0, 10, 10])).toEqual({ ok: true, bbox: "0,0,10,10" });
    expect(viewportToBbox([0, 0, 10.00002, 5])).toEqual({ ok: false, reason: "too-large" });
    expect(viewportToBbox([0, 0, 5, 30])).toEqual({ ok: false, reason: "too-large" });
  });

  it("rejects a wrapped/out-of-range viewport", () => {
    expect(viewportToBbox([-181, 0, -175, 5])).toEqual({ ok: false, reason: "out-of-range" });
    expect(viewportToBbox([0, 80, 5, 86])).toEqual({ ok: false, reason: "out-of-range" });
  });
});
