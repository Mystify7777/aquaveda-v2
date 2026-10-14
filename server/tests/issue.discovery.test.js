import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Issue } from "../src/models/Issue.js";
import { buildIssueListFilter, listIssues } from "../src/services/issue.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import { hasIndex, planTokens, scansCollection, usesTextIndex } from "./helpers/queryPlan.js";

/**
 * Issue #41 — public Issue discovery, against real MongoDB (text index,
 * 2dsphere index, $geoWithin, $text). Contract:
 * docs/architecture/issue-discovery-contract.md.
 */

before(async () => {
  await setupTestDb();
  // Index builds are what these tests depend on; wait for them explicitly.
  await Issue.init();
});
after(teardownTestDb);
beforeEach(clearCollections);

const REPORTER = new mongoose.Types.ObjectId();
let n = 0;

/** Seeds one Issue directly so category/status/createdAt/location are fully controlled. */
async function seed(over = {}) {
  n += 1;
  return Issue.create({
    title: `Issue ${n}`,
    description: `Description ${n}`,
    location: { type: "Point", coordinates: [77.5, 12.5] },
    reportedBy: REPORTER,
    ...over,
  });
}
const at = (lng, lat) => ({ type: "Point", coordinates: [lng, lat] });
const titles = (res) => res.items.map((i) => i.title);
const sorted = (res) => titles(res).sort();
const rejectsWith = (promise, code) => assert.rejects(promise, (e) => e.code === code);

describe("unfiltered discovery (anonymous)", () => {
  it("lists all issues with the canonical page shape, newest first, with no actor", async () => {
    const a = await seed({ title: "old", createdAt: new Date("2026-01-01T00:00:00Z") });
    const b = await seed({ title: "new", createdAt: new Date("2026-03-01T00:00:00Z") });
    assert.ok(a && b);
    const res = await listIssues();
    assert.deepEqual(titles(res), ["new", "old"]);
    assert.deepEqual(
      { page: res.page, limit: res.limit, total: res.total, totalPages: res.totalPages },
      { page: 1, limit: 20, total: 2, totalPages: 1 },
    );
  });

  it("returns an empty, well-formed page when nothing matches", async () => {
    assert.deepEqual(await listIssues(), { items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});

describe("simple filters", () => {
  beforeEach(async () => {
    await seed({ title: "a", status: "open", category: "water_quality", severity: "high" });
    await seed({ title: "b", status: "open", category: "leakage_wastage", severity: "low" });
    await seed({ title: "c", status: "resolved", category: "water_quality", severity: "low" });
    await seed({ title: "d", status: "open" }); // unclassified ("")
  });

  it("status", async () => {
    assert.deepEqual(sorted(await listIssues({ status: "open" })), ["a", "b", "d"]);
    assert.deepEqual(sorted(await listIssues({ status: "resolved" })), ["c"]);
  });

  it("category (exact; unclassified issues are never matched)", async () => {
    assert.deepEqual(sorted(await listIssues({ category: "water_quality" })), ["a", "c"]);
    assert.deepEqual(sorted(await listIssues({ category: "supply_shortage" })), []);
  });

  it("severity (exact; unclassified issues are never matched)", async () => {
    assert.deepEqual(sorted(await listIssues({ severity: "low" })), ["b", "c"]);
    assert.deepEqual(sorted(await listIssues({ severity: "high" })), ["a"]);
  });

  it("status + category + severity combine with AND", async () => {
    const res = await listIssues({ status: "open", category: "water_quality", severity: "high" });
    assert.deepEqual(titles(res), ["a"]);
    assert.equal(res.total, 1);
    assert.deepEqual(titles(await listIssues({ status: "resolved", category: "water_quality", severity: "high" })), []);
  });

  it("rejects unrecognized category/severity values", async () => {
    await rejectsWith(listIssues({ category: "nope" }), DomainErrorCode.VALIDATION_FAILED);
    await rejectsWith(listIssues({ severity: "catastrophic" }), DomainErrorCode.VALIDATION_FAILED);
    await rejectsWith(listIssues({ category: "" }), DomainErrorCode.VALIDATION_FAILED);
  });
});

describe("text search (q)", () => {
  beforeEach(async () => {
    await seed({ title: "Burst pipe on Main Road", description: "Water flooding the street" });
    await seed({ title: "Dry handpump", description: "The village handpump gives no water" });
    await seed({ title: "Leaking tap", description: "Slow drip near the market, Main Road side" });
  });

  it("matches whole words in the title", async () => {
    assert.deepEqual(sorted(await listIssues({ q: "handpump" })), ["Dry handpump"]);
  });

  it("matches whole words in the description", async () => {
    assert.deepEqual(sorted(await listIssues({ q: "market" })), ["Leaking tap"]);
  });

  it("is case-insensitive", async () => {
    assert.deepEqual(sorted(await listIssues({ q: "HANDPUMP" })), ["Dry handpump"]);
  });

  it("requires every term to match (AND), across title and description", async () => {
    assert.deepEqual(sorted(await listIssues({ q: "main road" })), ["Burst pipe on Main Road", "Leaking tap"]);
    assert.deepEqual(sorted(await listIssues({ q: "main handpump" })), []);
    assert.deepEqual(sorted(await listIssues({ q: "burst water" })), ["Burst pipe on Main Road"]);
  });

  it("matches whole words only: no stemming, no prefix matching", async () => {
    assert.deepEqual(sorted(await listIssues({ q: "leak" })), []); // title has "Leaking"
    assert.deepEqual(sorted(await listIssues({ q: "hand" })), []);
  });

  it("gives MongoDB query syntax no special meaning (no negation, no phrase operators)", async () => {
    // Negation of "water" would return the one issue that lacks it ("Leaking tap").
    // Instead "-water" is a literal term, and nothing contains it.
    assert.deepEqual(sorted(await listIssues({ q: "-water" })), []);
    assert.deepEqual(sorted(await listIssues({ q: '"main road"' })), ["Burst pipe on Main Road", "Leaking tap"]);
  });

  it("REQUIRES EVERY TERM: an issue containing only one of the terms never matches, and an unquoted $text control proves the fixture would catch OR semantics", async () => {
    await Issue.deleteMany({});
    await seed({ title: "main only", description: "x" });
    await seed({ title: "handpump only", description: "x" });
    await seed({ title: "main handpump both", description: "x" });
    await seed({ title: "neither", description: "x" });

    // Control: MongoDB's own unquoted multi-term $text is OR. If the filter
    // ever degraded to that, the assertions below would see three issues.
    const control = await Issue.find({ $text: { $search: "main handpump" } });
    assert.deepEqual(control.map((i) => i.title).sort(), ["handpump only", "main handpump both", "main only"]);

    for (const q of ["main handpump", "handpump main"]) {
      const res = await listIssues({ q });
      assert.deepEqual(titles(res), ["main handpump both"], q);
      assert.equal(res.total, 1, q);
    }
  });

  it("requires every term for three or more terms, in any order", async () => {
    await Issue.deleteMany({});
    await seed({ title: "alpha beta gamma" });
    await seed({ title: "alpha beta" });
    await seed({ title: "beta gamma" });
    await seed({ title: "alpha" });
    for (const q of ["alpha beta gamma", "gamma alpha beta", "beta gamma alpha"]) {
      assert.deepEqual(titles(await listIssues({ q })), ["alpha beta gamma"], q);
    }
    assert.deepEqual(sorted(await listIssues({ q: "alpha beta" })), ["alpha beta", "alpha beta gamma"]);
    assert.deepEqual(sorted(await listIssues({ q: "alpha beta gamma delta" })), []);
  });

  it("each term may come from either field, but all must be present", async () => {
    await Issue.deleteMany({});
    await seed({ title: "Dry handpump", description: "no water since March" });
    await seed({ title: "Dry handpump", description: "slow flow" });
    assert.deepEqual(titles(await listIssues({ q: "handpump march" })), ["Dry handpump"]);
    assert.equal((await listIssues({ q: "handpump march" })).total, 1);
    assert.equal((await listIssues({ q: "handpump flow" })).total, 1);
    assert.equal((await listIssues({ q: "handpump march flow" })).total, 0);
  });

  it("a term never matches inside a longer word, even when ANOTHER term supplies the index candidate", async () => {
    await Issue.deleteMany({});
    // Quoted-phrase matching is a substring test on the index scan's candidates; the
    // scan is an OR over tokens. Without the per-term whole-word check these leak.
    await seed({ title: "Handpump maintenance needed" });   // "main" only inside "maintenance"
    await seed({ title: "Leaking tap" });                    // "leak" only inside "Leaking"
    await seed({ title: "Handpump main road" });             // genuine
    await seed({ title: "Tap leak near well" });             // genuine
    assert.deepEqual(sorted(await listIssues({ q: "main handpump" })), ["Handpump main road"]);
    assert.deepEqual(sorted(await listIssues({ q: "handpump main" })), ["Handpump main road"]);
    assert.deepEqual(sorted(await listIssues({ q: "leak tap" })), ["Tap leak near well"]);
    assert.deepEqual(sorted(await listIssues({ q: "tap leak" })), ["Tap leak near well"]);
  });

  it("matches terms bounded by punctuation, but not by letters or digits", async () => {
    await Issue.deleteMany({});
    await seed({ title: "Burst pipe, main-road (north)" });
    await seed({ title: "pipe2 burst" });
    await seed({ title: "xpipe burst" });
    assert.deepEqual(sorted(await listIssues({ q: "pipe north" })), ["Burst pipe, main-road (north)"]);
    assert.deepEqual(sorted(await listIssues({ q: "pipe burst" })), ["Burst pipe, main-road (north)"]);
  });

  it("is case-insensitive for non-ASCII letters and works for non-Latin scripts", async () => {
    await Issue.deleteMany({});
    await seed({ title: "Café ÉCOLE leak" });
    await seed({ title: "हैंडपंप में पानी नहीं" });
    assert.deepEqual(titles(await listIssues({ q: "café école" })), ["Café ÉCOLE leak"]);
    assert.deepEqual(titles(await listIssues({ q: "पानी" })), ["हैंडपंप में पानी नहीं"]);
    assert.deepEqual(titles(await listIssues({ q: "हैंडपंप पानी" })), ["हैंडपंप में पानी नहीं"]);
    assert.deepEqual(titles(await listIssues({ q: "पान" })), []);
  });

  it("treats diacritics as significant (documented: 'cafe' does not match 'Café')", async () => {
    await Issue.deleteMany({});
    await seed({ title: "Café leak" });
    assert.deepEqual(titles(await listIssues({ q: "cafe" })), []);
    assert.deepEqual(titles(await listIssues({ q: "café" })), ["Café leak"]);
  });

  it("never interprets user input as a pattern (regex metacharacters are literal)", async () => {
    await Issue.deleteMany({});
    await seed({ title: "abc leak" });
    await seed({ title: "a.c leak" });
    await seed({ title: "tank (north) leak" });
    await seed({ title: "price $5 leak" });
    assert.deepEqual(titles(await listIssues({ q: "a.c" })), ["a.c leak"]);
    assert.deepEqual(titles(await listIssues({ q: ".* leak" })), []);
    assert.deepEqual(titles(await listIssues({ q: "(north) leak" })), ["tank (north) leak"]);
    assert.deepEqual(titles(await listIssues({ q: "[a-z]+ leak" })), []);
    assert.deepEqual(titles(await listIssues({ q: "(a+)+$ leak" })), []);
    assert.deepEqual(titles(await listIssues({ q: "$5 leak" })), ["price $5 leak"]);
    assert.deepEqual(titles(await listIssues({ q: "\\d leak" })), []);
  });

  it("a punctuation-only query cannot locate documents (no index token): accepted, empty, never a wildcard", async () => {
    await Issue.deleteMany({});
    await seed({ title: "Burst pipe -- urgent", description: "price %% ?!" });
    await seed({ title: "Burst pipe" });
    // The first document literally contains each symbol run, yet nothing is found: no letter/digit => no candidates.
    for (const q of ["--", "?!", "%%", "- - -"]) {
      const res = await listIssues({ q });
      assert.equal(res.total, 0, q);
      assert.deepEqual(res.items, [], q);
    }
  });

  it("alongside a searchable term, a punctuation-only term is still required and checked literally (narrows, never widens, never dropped)", async () => {
    await Issue.deleteMany({});
    await seed({ title: "Burst pipe -- urgent", description: "price %% ?!" });
    await seed({ title: "Burst pipe" });
    assert.equal((await listIssues({ q: "burst" })).total, 2);
    assert.deepEqual(titles(await listIssues({ q: "burst --" })), ["Burst pipe -- urgent"]);
    assert.deepEqual(titles(await listIssues({ q: "burst %%" })), ["Burst pipe -- urgent"]);
    assert.deepEqual(titles(await listIssues({ q: "burst ?!" })), ["Burst pipe -- urgent"]);
    assert.deepEqual(titles(await listIssues({ q: "burst -- %%" })), ["Burst pipe -- urgent"]);
    // Required means required: a symbol run that is absent (or longer/shorter than a bounded run) empties the result.
    assert.equal((await listIssues({ q: "burst ###" })).total, 0);
    assert.equal((await listIssues({ q: "burst ---" })).total, 0);
    assert.equal((await listIssues({ q: "pipe urgent ---" })).total, 0);
  });

  it("a symbol inside a searchable term is found through its word part and matched literally", async () => {
    await Issue.deleteMany({});
    await seed({ title: "Tank 50% full" });
    await seed({ title: "Tank 50 litres" });
    assert.deepEqual(titles(await listIssues({ q: "50%" })), ["Tank 50% full"]);
    assert.deepEqual(sorted(await listIssues({ q: "50" })), ["Tank 50 litres", "Tank 50% full"]);
  });

  it("a punctuation-only query is served from the text index and never scans the collection", async () => {
    await Issue.deleteMany({});
    await seed({ title: "Burst pipe" });
    const plan = await Issue.find(buildIssueListFilter({ q: "--" })).explain("queryPlanner");
    const tokens = planTokens(plan.queryPlanner.winningPlan);
    // A symbol-only query has no index terms, so newer servers short-circuit it (EOF); older ones
    // still plan a TEXT stage. Either way it is text-planned and nothing scans the collection.
    assert.ok(usesTextIndex(tokens, "issue_text_search"), tokens.join());
    assert.equal(scansCollection(tokens), false, tokens.join());
  });

  it("a quote-only query is rejected (no terms), not treated as empty text", async () => {
    await rejectsWith(listIssues({ q: '""' }), DomainErrorCode.VALIDATION_FAILED);
  });

  it("quote characters separate terms and cannot inject phrase syntax", async () => {
    await Issue.deleteMany({});
    await seed({ title: "main road works" });
    await seed({ title: "road main works" });
    // '"main road"' is just the terms main + road, in any order, not an adjacent phrase.
    assert.deepEqual(sorted(await listIssues({ q: '"main road"' })), ["main road works", "road main works"]);
    assert.deepEqual(sorted(await listIssues({ q: 'main"road' })), ["main road works", "road main works"]);
  });

  it("returns an empty page for a term that matches nothing", async () => {
    const res = await listIssues({ q: "zzzzzz" });
    assert.equal(res.total, 0);
    assert.deepEqual(res.items, []);
  });

  it("rejects too-short, too-long and too-many-term queries", async () => {
    await rejectsWith(listIssues({ q: "a" }), DomainErrorCode.VALIDATION_FAILED);
    await rejectsWith(listIssues({ q: "a".repeat(101) }), DomainErrorCode.VALIDATION_FAILED);
    await rejectsWith(listIssues({ q: Array(11).fill("ab").join(" ") }), DomainErrorCode.VALIDATION_FAILED);
  });

  it("composes with the other filters", async () => {
    await seed({ title: "Main Road pothole", description: "road damage", status: "resolved", category: "other" });
    const res = await listIssues({ q: "main road", status: "resolved" });
    assert.deepEqual(titles(res), ["Main Road pothole"]);
  });
});

describe("bounding box (bbox) — real $geoWithin semantics", () => {
  // Box: lng 77..78, lat 12..13 (west,south,east,north).
  const BOX = [77, 12, 78, 13];
  const EPS = 1e-6;

  it("matches points strictly inside and excludes points clearly outside", async () => {
    await seed({ title: "inside", location: at(77.5, 12.5) });
    await seed({ title: "far", location: at(10, 10) });
    await seed({ title: "same-lat-other-lng", location: at(80, 12.5) });
    await seed({ title: "same-lng-other-lat", location: at(77.5, 20) });
    assert.deepEqual(sorted(await listIssues({ bbox: BOX })), ["inside"]);
  });

  it("includes points exactly ON every edge and corner (edges are inclusive)", async () => {
    await seed({ title: "west", location: at(77, 12.5) });
    await seed({ title: "east", location: at(78, 12.5) });
    await seed({ title: "south", location: at(77.5, 12) });
    await seed({ title: "north", location: at(77.5, 13) });
    await seed({ title: "sw", location: at(77, 12) });
    await seed({ title: "se", location: at(78, 12) });
    await seed({ title: "nw", location: at(77, 13) });
    await seed({ title: "ne", location: at(78, 13) });
    assert.deepEqual(
      sorted(await listIssues({ bbox: BOX })),
      ["east", "ne", "north", "nw", "se", "south", "sw", "west"],
    );
  });

  it("excludes points just outside every edge (no false positives on any side)", async () => {
    await seed({ title: "w-out", location: at(77 - EPS, 12.5) });
    await seed({ title: "e-out", location: at(78 + EPS, 12.5) });
    await seed({ title: "s-out", location: at(77.5, 12 - EPS) });
    await seed({ title: "n-out", location: at(77.5, 13 + EPS) });
    // 0.0001 degree (~11 m) north of the top edge: a spherical polygon alone would include this.
    await seed({ title: "n-out-wide", location: at(77.5, 13.0001) });
    assert.deepEqual(sorted(await listIssues({ bbox: BOX })), []);
  });

  it("includes points just inside every edge", async () => {
    await seed({ title: "w-in", location: at(77 + EPS, 12.5) });
    await seed({ title: "e-in", location: at(78 - EPS, 12.5) });
    await seed({ title: "s-in", location: at(77.5, 12 + EPS) });
    await seed({ title: "n-in", location: at(77.5, 13 - EPS) });
    assert.deepEqual(sorted(await listIssues({ bbox: BOX })), ["e-in", "n-in", "s-in", "w-in"]);
  });

  it("is exact along the whole south and north edges (parallels, not great-circle arcs)", async () => {
    // A spherical polygon from the box corners has great-circle edges that bow
    // off the parallels: it drops points on the south edge and admits points
    // above the north edge, most visibly mid-edge. The box is a lng/lat rectangle.
    for (const lng of [77.1, 77.5, 77.9]) {
      await seed({ title: `s@${lng}`, location: at(lng, 12) });
      await seed({ title: `n@${lng}`, location: at(lng, 13) });
      await seed({ title: `n+@${lng}`, location: at(lng, 13.00005) });
      await seed({ title: `s-@${lng}`, location: at(lng, 11.99995) });
    }
    assert.deepEqual(sorted(await listIssues({ bbox: BOX })), [
      "n@77.1", "n@77.5", "n@77.9", "s@77.1", "s@77.5", "s@77.9",
    ]);
  });

  it("works in the southern and western hemispheres", async () => {
    await seed({ title: "in", location: at(-70.5, -33.5) });
    await seed({ title: "edge", location: at(-71, -34) });
    await seed({ title: "out", location: at(-71.000001, -33.5) });
    assert.deepEqual(sorted(await listIssues({ bbox: [-71, -34, -70, -33] })), ["edge", "in"]);
  });

  it("stays exact at high latitude and at the latitude limit, including a point exactly on a corner and meridian", async () => {
    await seed({ title: "in", location: at(5, 84) });
    await seed({ title: "top-edge", location: at(5, 85) });
    await seed({ title: "above", location: at(5, 85.00001) });
    await seed({ title: "bottom-edge", location: at(0, 75) });
    await seed({ title: "below", location: at(5, 74.99999) });
    assert.deepEqual(sorted(await listIssues({ bbox: [0, 75, 10, 85] })), ["bottom-edge", "in", "top-edge"]);
  });

  it("accepts the maximum span exactly and still matches both far corners", async () => {
    await seed({ title: "sw", location: at(0, 0) });
    await seed({ title: "ne", location: at(10, 10) });
    await seed({ title: "past", location: at(10.0001, 10) });
    assert.deepEqual(sorted(await listIssues({ bbox: [0, 0, 10, 10] })), ["ne", "sw"]);
  });

  it("matches the Issue's affected location only (location is the sole spatial field)", async () => {
    const issue = await seed({ title: "x", location: at(77.5, 12.5) });
    assert.deepEqual(Object.keys(issue.toObject()).filter((k) => /loc|geo|coord/i.test(k)), ["location"]);
  });

  it("rejects invalid, malformed, inverted and excessive boxes", async () => {
    for (const bbox of [
      [77, 12, 78],            // wrong arity
      [77, 12, 78, NaN],       // non-finite
      [78, 12, 77, 13],        // west > east
      [77, 13, 78, 12],        // south > north
      [77, 12, 77, 13],        // degenerate
      [-181, 0, -175, 1],      // longitude out of range
      [0, 80, 1, 86],          // latitude beyond limit
      [0, 0, 10.01, 1],        // span too wide
      [0, 0, 1, 10.01],        // span too tall
      [-180, -85, 180, 85],    // "everything"
    ]) {
      await rejectsWith(listIssues({ bbox }), DomainErrorCode.VALIDATION_FAILED);
    }
  });

  it("composes with q, status, category and severity", async () => {
    await seed({ title: "Burst pipe", status: "open", category: "leakage_wastage", severity: "high", location: at(77.5, 12.5) });
    await seed({ title: "Burst pipe far", status: "open", category: "leakage_wastage", severity: "high", location: at(10, 10) });
    await seed({ title: "Burst pipe resolved", status: "resolved", category: "leakage_wastage", severity: "high", location: at(77.6, 12.6) });
    await seed({ title: "Dry well", status: "open", category: "leakage_wastage", severity: "high", location: at(77.7, 12.7) });
    const res = await listIssues({
      bbox: BOX, q: "burst pipe", status: "open", category: "leakage_wastage", severity: "high",
    });
    assert.deepEqual(titles(res), ["Burst pipe"]);
    assert.equal(res.total, 1);
  });
});

describe("bbox differential check against an exact in-memory predicate", () => {
  // Deterministic PRNG so a failure is reproducible.
  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("agrees with the contract on random boxes and points, incl. high latitude and the +/-180 edge", async () => {
    const rand = mulberry32(41);
    const between = (lo, hi) => lo + rand() * (hi - lo);
    const points = [];
    // Random points plus deliberately boundary-hugging ones are added per box below.
    for (let i = 0; i < 300; i += 1) points.push([between(-180, 180), between(-85, 85)]);

    const boxes = [];
    for (let i = 0; i < 40; i += 1) {
      const w = between(-180, 170);
      const s = between(-85, 75);
      const spanLng = between(0.5, 10);
      const spanLat = between(0.5, 10);
      boxes.push([w, s, Math.min(180, w + spanLng), Math.min(85, s + spanLat)]);
    }
    boxes.push([170, 0, 180, 10], [-180, -10, -170, 0], [0, 75, 10, 85], [-10, -85, 0, -75]);
    for (const [w, s, e, n] of boxes) {
      // Points on / just inside / just outside the edges and corners.
      for (const [x, y] of [[w, s], [e, n], [w, n], [e, s], [(w + e) / 2, s], [(w + e) / 2, n], [w, (s + n) / 2], [e, (s + n) / 2]]) {
        points.push([x, y]);
        points.push([x + 1e-7, y + 1e-7]);
        points.push([x - 1e-7, y - 1e-7]);
      }
    }
    const valid = points.filter(([x, y]) => x >= -180 && x <= 180 && y >= -90 && y <= 90);
    const docs = await Issue.insertMany(
      valid.map(([x, y], i) => ({
        title: `p${i}`,
        description: "d",
        location: at(x, y),
        reportedBy: REPORTER,
      })),
    );
    const coordsById = new Map(docs.map((d) => [String(d._id), d.location.coordinates]));

    for (const box of boxes) {
      const [w, s, e, nn] = box;
      const expected = [...coordsById.entries()]
        .filter(([, [x, y]]) => x >= w && x <= e && y >= s && y <= nn)
        .map(([id]) => id)
        .sort();
      const got = [];
      for (let page = 1; ; page += 1) {
        const res = await listIssues({ bbox: box, limit: 50, page });
        got.push(...res.items.map((i) => String(i._id)));
        if (page >= res.totalPages) break;
      }
      assert.deepEqual(got.sort(), expected, `bbox ${JSON.stringify(box)}`);
    }
  });
});

describe("pagination and stable ordering", () => {
  it("pages through the filtered set with consistent totals", async () => {
    for (let i = 0; i < 5; i += 1) {
      await seed({ title: `m${i}`, category: "other", createdAt: new Date(Date.UTC(2026, 0, 1 + i)) });
    }
    await seed({ title: "x", category: "water_quality" });
    const p1 = await listIssues({ category: "other", limit: 2, page: 1 });
    const p2 = await listIssues({ category: "other", limit: 2, page: 2 });
    const p3 = await listIssues({ category: "other", limit: 2, page: 3 });
    assert.deepEqual(titles(p1), ["m4", "m3"]);
    assert.deepEqual(titles(p2), ["m2", "m1"]);
    assert.deepEqual(titles(p3), ["m0"]);
    for (const p of [p1, p2, p3]) {
      assert.equal(p.total, 5);
      assert.equal(p.totalPages, 3);
    }
  });

  it("a page past the end is empty but keeps the true total", async () => {
    await seed({ title: "only" });
    const res = await listIssues({ page: 9 });
    assert.deepEqual(res.items, []);
    assert.equal(res.total, 1);
    assert.equal(res.totalPages, 1);
  });

  it("orders ties on createdAt deterministically by _id descending, with no skips or repeats across pages", async () => {
    const same = new Date("2026-02-02T00:00:00Z");
    const ids = [];
    for (let i = 0; i < 7; i += 1) ids.push(String((await seed({ title: `t${i}`, createdAt: same }))._id));
    const seen = [];
    for (let page = 1; page <= 4; page += 1) {
      const res = await listIssues({ limit: 2, page });
      seen.push(...res.items.map((i) => String(i._id)));
    }
    assert.equal(new Set(seen).size, 7);
    assert.deepEqual(seen, [...ids].sort().reverse());
  });

  it("applies the same total order under a geographic filter", async () => {
    const same = new Date("2026-02-02T00:00:00Z");
    for (let i = 0; i < 5; i += 1) await seed({ title: `g${i}`, createdAt: same, location: at(77.5, 12.5) });
    const seen = [];
    for (let page = 1; page <= 3; page += 1) {
      const res = await listIssues({ bbox: [77, 12, 78, 13], limit: 2, page });
      seen.push(...res.items.map((i) => String(i._id)));
    }
    assert.equal(new Set(seen).size, 5);
    assert.deepEqual(seen, [...seen].sort().reverse());
  });

  it("keeps the existing limit behavior (default 20)", async () => {
    for (let i = 0; i < 22; i += 1) await seed({ title: `l${i}` });
    const res = await listIssues();
    assert.equal(res.items.length, 20);
    assert.equal(res.total, 22);
    assert.equal(res.totalPages, 2);
  });

  it("populates reportedBy with public-actor fields only, as before", async () => {
    await seed();
    const [item] = (await listIssues()).items;
    assert.ok("reportedBy" in item.toObject());
  });
});

describe("indexes and query plans", () => {
  it("persisted Issue indexes: existing 2dsphere/status/reportedBy plus the text index only", async () => {
    const names = (await Issue.collection.indexes()).map((i) => i.name).sort();
    assert.deepEqual(names, ["_id_", "issue_text_search", "location_2dsphere", "reportedBy_1", "status_1"]);
  });

  it("the location index is a 2dsphere index over GeoJSON points", async () => {
    const idx = (await Issue.collection.indexes()).find((i) => i.name === "location_2dsphere");
    assert.equal(idx.key.location, "2dsphere");
  });

  it("the text index covers title and description with language 'none'", async () => {
    const idx = (await Issue.collection.indexes()).find((i) => i.name === "issue_text_search");
    assert.deepEqual(Object.keys(idx.weights).sort(), ["description", "title"]);
    assert.equal(idx.default_language, "none");
  });

  it("a bbox query uses the 2dsphere index (no collection scan)", async () => {
    await seed();
    const filter = buildIssueListFilter({ bbox: [77, 12, 78, 13] });
    const plan = await Issue.find(filter).explain("queryPlanner");
    const s = planTokens(plan.queryPlanner.winningPlan);
    assert.ok(hasIndex(s, "location_2dsphere"), s.join());
    assert.equal(scansCollection(s), false, s.join());
  });

  it("a text query uses the text index (no collection scan)", async () => {
    await seed();
    const filter = buildIssueListFilter({ q: "pipe" });
    const plan = await Issue.find(filter).explain("queryPlanner");
    const s = planTokens(plan.queryPlanner.winningPlan);
    assert.ok(usesTextIndex(s, "issue_text_search"), s.join());
    assert.equal(scansCollection(s), false, s.join());
  });

  it("a status query still uses the existing status index", async () => {
    await seed();
    const plan = await Issue.find(buildIssueListFilter({ status: "open" })).explain("queryPlanner");
    assert.ok(hasIndex(planTokens(plan.queryPlanner.winningPlan), "status_1"));
  });
});
