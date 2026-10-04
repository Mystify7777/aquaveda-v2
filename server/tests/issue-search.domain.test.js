import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BBOX_MAX_SPAN_DEGREES,
  SEARCH_TEXT_MAX_LENGTH,
  SEARCH_TEXT_MAX_TERMS,
  bboxProblem,
  parseBbox,
  searchTerms,
  searchTextProblem,
} from "../src/domain/issue-search.js";

/** Pure rules for Issue #41 discovery (no DB). */

describe("parseBbox", () => {
  it("parses west,south,east,north into numbers", () => {
    assert.deepEqual(parseBbox("77,12,78,13"), [77, 12, 78, 13]);
    assert.deepEqual(parseBbox("-77.5, -12.25 ,78,13"), [-77.5, -12.25, 78, 13]);
  });

  for (const bad of ["", "1,2,3", "1,2,3,4,5", "1,,3,4", "a,b,c,d", "1,2,3,NaN", "1,2,3,Infinity", " , , , ", undefined, null, 5]) {
    it(`rejects malformed ${JSON.stringify(bad)}`, () => {
      assert.equal(parseBbox(bad), null);
    });
  }
});

describe("bboxProblem", () => {
  it("accepts a valid box, including the exact maximum span", () => {
    assert.equal(bboxProblem([77, 12, 78, 13]), null);
    assert.equal(bboxProblem([0, 0, BBOX_MAX_SPAN_DEGREES, BBOX_MAX_SPAN_DEGREES]), null);
    assert.equal(bboxProblem([-180, -85, -170, -75]), null);
    assert.equal(bboxProblem([170, 75, 180, 85]), null);
  });

  const cases = [
    ["span over the cap (longitude)", [0, 0, BBOX_MAX_SPAN_DEGREES + 0.01, 1], /span/],
    ["span over the cap (latitude)", [0, 0, 1, BBOX_MAX_SPAN_DEGREES + 0.01], /span/],
    ["west >= east", [78, 12, 77, 13], /west must be less than east/],
    ["west == east (degenerate)", [77, 12, 77, 13], /west must be less than east/],
    ["south >= north", [77, 13, 78, 12], /south must be less than north/],
    ["south == north (degenerate)", [77, 12, 78, 12], /south must be less than north/],
    ["longitude below -180", [-180.1, 0, -175, 1], /longitudes/],
    ["longitude above 180", [175, 0, 180.1, 1], /longitudes/],
    ["latitude above 85", [0, 80, 1, 85.1], /latitudes/],
    ["latitude below -85", [0, -85.1, 1, -80], /latitudes/],
    ["not four numbers", [1, 2, 3], /four numbers/],
    ["non-finite", [0, 0, 1, NaN], /four numbers/],
    ["not an array", "77,12,78,13", /four numbers/],
  ];
  for (const [name, bbox, pattern] of cases) {
    it(`rejects ${name}`, () => {
      assert.match(String(bboxProblem(bbox)), pattern);
    });
  }
});

describe("search text rules", () => {
  it("splits on any whitespace and drops empties", () => {
    assert.deepEqual(searchTerms("  water   leak\tmain\nroad "), ["water", "leak", "main", "road"]);
  });

  it("treats double quotes as separators, so quotes can never carry query syntax", () => {
    assert.deepEqual(searchTerms('"main road"'), ["main", "road"]);
    assert.deepEqual(searchTerms('ma"in'), ["ma", "in"]);
    assert.deepEqual(searchTerms('main "'), ["main"]);
    assert.deepEqual(searchTerms('""'), []);
  });

  it("accepts text within bounds (length measured after trimming)", () => {
    assert.equal(searchTextProblem("ab"), null);
    assert.equal(searchTextProblem("  ab  "), null);
    assert.equal(searchTextProblem("a".repeat(SEARCH_TEXT_MAX_LENGTH)), null);
    assert.equal(searchTextProblem(Array(SEARCH_TEXT_MAX_TERMS).fill("a").join(" ")), null);
  });

  it("rejects too short, too long, too many terms, and non-strings", () => {
    assert.match(searchTextProblem(""), /at least/);
    assert.match(searchTextProblem("a"), /at least/);
    assert.match(searchTextProblem("   a   "), /at least/);
    assert.match(searchTextProblem('""'), /at least one search term/);
    assert.match(searchTextProblem('" "'), /at least one search term/);
    assert.match(searchTextProblem("a".repeat(SEARCH_TEXT_MAX_LENGTH + 1)), /at most \d+ characters/);
    assert.match(searchTextProblem(Array(SEARCH_TEXT_MAX_TERMS + 1).fill("a").join(" ")), /at most \d+ terms/);
    assert.match(searchTextProblem(undefined), /must be a string/);
    assert.match(searchTextProblem(["a", "b"]), /must be a string/);
  });
});
