import { describe, it, expect } from "vitest";

import { toLatLng, toMappableIssues } from "@/lib/issues/geo";
import { ISSUE_STATUS_LABELS, parseIssueStatus } from "@/lib/issues/status";
import { categoryLabel, severityLabel } from "@/lib/issues/labels";
import { ISSUE_CATEGORIES, ISSUE_SEVERITIES } from "@/lib/issues/classification";
import type { Issue } from "@/lib/api/types/issue";

const issue = (id: string, coordinates: unknown): Issue =>
  ({ _id: id, title: `T${id}`, location: { type: "Point", coordinates } }) as unknown as Issue;

describe("toLatLng", () => {
  it("swaps GeoJSON [lng, lat] into Leaflet [lat, lng]", () => {
    expect(toLatLng({ type: "Point", coordinates: [77.5, 12.9] })).toEqual([12.9, 77.5]);
  });

  it.each([
    [undefined],
    [[1]],
    [[1, 2, 3]],
    [[NaN, 10]],
    [["77.5", "12.9"]],
    [[181, 0]],
    [[0, 91]],
    [[0, -91]],
  ])("rejects malformed/out-of-range coordinates %j", (coordinates) => {
    expect(toLatLng(coordinates === undefined ? undefined : ({ type: "Point", coordinates } as never))).toBeNull();
  });

  it("accepts the boundary values", () => {
    expect(toLatLng({ type: "Point", coordinates: [180, 90] })).toEqual([90, 180]);
    expect(toLatLng({ type: "Point", coordinates: [-180, -90] })).toEqual([-90, -180]);
  });
});

describe("toMappableIssues", () => {
  it("keeps valid issues and skips unusable ones without throwing", () => {
    const out = toMappableIssues([issue("1", [77.5, 12.9]), issue("2", [999, 0]), issue("3", [1, 2])]);
    expect(out).toEqual([
      { id: "1", title: "T1", position: [12.9, 77.5] },
      { id: "3", title: "T3", position: [2, 1] },
    ]);
  });
});

describe("status + label helpers", () => {
  it("parseIssueStatus accepts only the five existing statuses", () => {
    for (const s of Object.keys(ISSUE_STATUS_LABELS)) expect(parseIssueStatus(s)).toBe(s);
    expect(parseIssueStatus("closed")).toBeUndefined();
    expect(parseIssueStatus("")).toBeUndefined();
    expect(parseIssueStatus(undefined)).toBeUndefined();
    expect(parseIssueStatus(["resolved", "open"])).toBe("resolved");
  });

  it("category/severity labels come from the canonical contract; '' and unknown are null", () => {
    expect(categoryLabel(ISSUE_CATEGORIES[0].value)).toBe(ISSUE_CATEGORIES[0].label);
    expect(severityLabel(ISSUE_SEVERITIES[0].value)).toBe(ISSUE_SEVERITIES[0].label);
    expect(categoryLabel("")).toBeNull();
    expect(severityLabel("catastrophic")).toBeNull();
  });
});
