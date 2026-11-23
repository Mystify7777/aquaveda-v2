import assert from "node:assert/strict";
import test from "node:test";

import {
  REGION_ALIASES,
  REGION_NORMALIZATION_TEST_VECTORS,
  normalizeRegionBase,
  normalizeRegionKey,
} from "../src/domain/region-normalization.js";

test("ADR-0011 Region base normalization matches the shared vectors", () => {
  for (const vector of REGION_NORMALIZATION_TEST_VECTORS) {
    assert.equal(
      normalizeRegionBase(vector.input),
      vector.expectedBase,
      vector.input,
    );
  }
});

test("Region matching key preserves unresolved distinctions", () => {
  assert.equal(normalizeRegionKey("Bihar"), "bihar");
  assert.equal(normalizeRegionKey("Bihar, India"), "bihar, india");
});

test("blank and non-string Region values are unclassified", () => {
  assert.equal(normalizeRegionBase("  \t\n "), "");
  assert.equal(normalizeRegionKey(null), "");
  assert.equal(normalizeRegionKey(undefined), "");
  assert.equal(normalizeRegionKey(123), "");
});

test("V1 Region aliases are explicit and currently empty", () => {
  assert.deepEqual(REGION_ALIASES, {});
});
