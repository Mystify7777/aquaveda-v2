import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LOCATION_LABEL_MAX_LENGTH,
  compactLocationLabel,
  locationLabelProblem,
  normalizeLocationLabel,
} from "../src/domain/location-label.js";
import { createIssueSchema } from "../src/validation/issue.validation.js";

const POINT = { type: "Point", coordinates: [77.5, 12.9] };
const base = { title: "t", description: "d", location: POINT };

describe("normalizeLocationLabel", () => {
  it("collapses whitespace/newlines, strips controls and bidi/zero-width, trims, NFC", () => {
    assert.equal(normalizeLocationLabel("  MG\tRoad,\n Bengaluru  "), "MG Road, Bengaluru");
    assert.equal(normalizeLocationLabel("a\u202Eb\u200Bc\u0007d"), "abcd");
    assert.equal(normalizeLocationLabel("Cafe\u0301"), "Caf\u00e9");
  });
  it("returns undefined for blank and non-string input", () => {
    for (const v of ["", "   ", "\n\t", undefined, null, 5, {}]) {
      assert.equal(normalizeLocationLabel(v), undefined);
    }
  });
});

describe("locationLabelProblem", () => {
  it("accepts undefined and in-range text, rejects over-length and angle brackets", () => {
    assert.equal(locationLabelProblem(undefined), null);
    assert.equal(locationLabelProblem("x".repeat(LOCATION_LABEL_MAX_LENGTH)), null);
    assert.match(locationLabelProblem("x".repeat(LOCATION_LABEL_MAX_LENGTH + 1)), /at most/);
    assert.match(locationLabelProblem("<b>x</b>"), /'<' or '>'/);
  });
});

describe("compactLocationLabel", () => {
  it("passes short names through and strips angle brackets", () => {
    assert.equal(compactLocationLabel("Patna, Bihar, India"), "Patna, Bihar, India");
    assert.equal(compactLocationLabel("A <b> B"), "A b B");
  });
  it("shortens long names at a comma boundary within the limit, with an ellipsis", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Segment${i}`).join(", ");
    const out = compactLocationLabel(long);
    assert.ok(out.length <= LOCATION_LABEL_MAX_LENGTH);
    assert.ok(out.endsWith("…"));
    assert.equal(locationLabelProblem(out), null);
    assert.ok(!/, …$/.test(out));
  });
  it("hard-cuts a long name with no comma boundary and stays within the limit", () => {
    const out = compactLocationLabel("x".repeat(500));
    assert.equal(out.length, LOCATION_LABEL_MAX_LENGTH);
    assert.ok(out.endsWith("…"));
  });
  it("returns undefined when nothing usable remains", () => {
    assert.equal(compactLocationLabel(" <> "), undefined);
    assert.equal(compactLocationLabel(undefined), undefined);
  });
});

describe("createIssueSchema.locationLabel (backward compatible, untrusted text)", () => {
  it("omitted label stays valid and absent", () => {
    const r = createIssueSchema.safeParse(base);
    assert.equal(r.success, true);
    assert.equal(r.data.locationLabel, undefined);
  });
  it("normalizes a valid label", () => {
    const r = createIssueSchema.safeParse({ ...base, locationLabel: "  Kankarbagh,\n Patna " });
    assert.equal(r.success, true);
    assert.equal(r.data.locationLabel, "Kankarbagh, Patna");
  });
  it("treats a blank label as absent", () => {
    const r = createIssueSchema.safeParse({ ...base, locationLabel: "   " });
    assert.equal(r.success, true);
    assert.equal(r.data.locationLabel, undefined);
  });
  it("rejects markup, over-length (after normalization) and non-strings", () => {
    for (const bad of ["<script>alert(1)</script>", "x".repeat(201), null, 12, ["a"], {}]) {
      const r = createIssueSchema.safeParse({ ...base, locationLabel: bad });
      assert.equal(r.success, false, `should reject ${JSON.stringify(bad)}`);
    }
  });
  it("accepts a label whose raw length exceeds 200 only because of collapsible whitespace", () => {
    const r = createIssueSchema.safeParse({ ...base, locationLabel: `A${" ".repeat(300)}B` });
    assert.equal(r.success, true);
    assert.equal(r.data.locationLabel, "A B");
  });
  it("never lets a label influence the coordinates", () => {
    const r = createIssueSchema.safeParse({ ...base, locationLabel: "North Pole" });
    assert.deepEqual(r.data.location, POINT);
  });
});
