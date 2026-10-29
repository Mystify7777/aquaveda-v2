import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createGeocoder } from "../src/services/geocoder.js";

const ATTRIBUTION = { text: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" };

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function harness(overrides = {}) {
  const calls = [];
  let clock = 1_000_000;
  const sleeps = [];
  const warnings = [];
  const fetchImpl = overrides.fetchImpl
    ? (url, init) => {
        calls.push({ url: new URL(url), init });
        return overrides.fetchImpl(url, init);
      }
    : async (url, init) => {
        calls.push({ url: new URL(url), init });
        return jsonResponse([{ lat: "25.5941", lon: "85.1376", display_name: "Patna, Bihar, India" }]);
      };
  const geocoder = createGeocoder({
    baseUrl: "https://geo.example/v1/",
    userAgent: "AquaVeda-test/1.0 (contact@example.test)",
    attribution: ATTRIBUTION,
    fetchImpl,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    logger: { warn: (m) => warnings.push(String(m)) },
    ...overrides.options,
  });
  return { geocoder, calls, sleeps, warnings, advance: (ms) => (clock += ms) };
}

describe("geocoder: request shape and normalization", () => {
  it("sends only the query with an identifying User-Agent; no credentials/cookies", async () => {
    const { geocoder, calls } = harness();
    const out = await geocoder.search("Patna");
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url.origin + url.pathname, "https://geo.example/v1/search");
    assert.equal(url.searchParams.get("q"), "Patna");
    assert.equal(url.searchParams.get("format"), "jsonv2");
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(url.searchParams.has("key"), false);
    assert.equal(init.headers["User-Agent"], "AquaVeda-test/1.0 (contact@example.test)");
    assert.equal(Object.keys(init.headers).some((h) => /cookie|authorization|forwarded/i.test(h)), false);
    assert.deepEqual(out, {
      results: [{ label: "Patna, Bihar, India", latitude: 25.5941, longitude: 85.1376 }],
      attribution: ATTRIBUTION,
    });
  });

  it("adds the API key as `key` only when configured", async () => {
    const { geocoder, calls } = harness({ options: { apiKey: "secret-key" } });
    await geocoder.search("Patna");
    assert.equal(calls[0].url.searchParams.get("key"), "secret-key");
  });

  it("drops unusable provider items (bad coords, empty label) and caps results", async () => {
    const items = [
      { lat: "abc", lon: "1", display_name: "bad lat" },
      { lat: "91", lon: "1", display_name: "lat out of range" },
      { lat: "1", lon: "181", display_name: "lon out of range" },
      { lat: "1", lon: "1", display_name: "   " },
      ...Array.from({ length: 8 }, (_, i) => ({ lat: String(i), lon: String(i), display_name: `Place ${i}` })),
    ];
    const { geocoder } = harness({ fetchImpl: async () => jsonResponse(items) });
    const { results } = await geocoder.search("anything");
    assert.equal(results.length, 5);
    assert.deepEqual(results[0], { label: "Place 0", latitude: 0, longitude: 0 });
  });

  it("returns an empty result list (not an error) when the provider finds nothing", async () => {
    const { geocoder } = harness({ fetchImpl: async () => jsonResponse([]) });
    assert.deepEqual((await geocoder.search("zzzzzz")).results, []);
  });

  it("sanitizes provider labels (angle brackets removed, length bounded)", async () => {
    const { geocoder } = harness({
      fetchImpl: async () => jsonResponse([{ lat: "1", lon: "2", display_name: `<img src=x>${"a, ".repeat(100)}` }]),
    });
    const [r] = (await geocoder.search("q")).results;
    assert.ok(!/[<>]/.test(r.label));
    assert.ok(r.label.length <= 200);
  });
});

describe("geocoder: failure behavior (never leaks provider detail or the query)", () => {
  for (const [name, fetchImpl] of [
    ["HTTP 500", async () => jsonResponse({}, 500)],
    ["HTTP 429", async () => jsonResponse({}, 429)],
    ["HTTP 403", async () => jsonResponse({}, 403)],
    ["network error", async () => { throw new TypeError("fetch failed: secret host"); }],
    ["non-JSON body", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } })],
    ["non-array JSON", async () => jsonResponse({ error: "nope" })],
  ]) {
    it(`${name} -> GEOCODER_UNAVAILABLE, generic message, nothing cached`, async () => {
      let n = 0;
      const { geocoder, warnings } = harness({
        fetchImpl: (...a) => { n += 1; return fetchImpl(...a); },
        options: { minIntervalMs: 0 },
      });
      await assert.rejects(() => geocoder.search("Sensitive Street 12"), (err) => {
        assert.equal(err.code, "GEOCODER_UNAVAILABLE");
        assert.equal(err.message, "Place search is not available right now.");
        return true;
      });
      assert.ok(warnings.every((w) => !/sensitive street/i.test(w) && !/secret host/i.test(w)));
      await assert.rejects(() => geocoder.search("Sensitive Street 12"));
      assert.equal(n, 2, "failures must not be cached");
    });
  }

  it("aborts a hung provider after timeoutMs", async () => {
    const { geocoder } = harness({
      fetchImpl: (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
      options: { timeoutMs: 20 },
    });
    await assert.rejects(() => geocoder.search("slow"), { code: "GEOCODER_UNAVAILABLE" });
  });
});

describe("geocoder: cache, de-duplication, throttle", () => {
  it("serves repeats (case/whitespace-insensitive) from cache within TTL, refetches after", async () => {
    const { geocoder, calls, advance } = harness({ options: { cacheTtlMs: 1000, minIntervalMs: 0 } });
    await geocoder.search("Patna  Junction");
    await geocoder.search("patna junction");
    assert.equal(calls.length, 1);
    advance(1001);
    await geocoder.search("Patna Junction");
    assert.equal(calls.length, 2);
  });

  it("caches an empty result too", async () => {
    const { geocoder, calls } = harness({ fetchImpl: async () => jsonResponse([]) });
    await geocoder.search("nowhere");
    await geocoder.search("nowhere");
    assert.equal(calls.length, 1);
  });

  it("evicts the least-recently-used entry beyond cacheMaxEntries", async () => {
    const { geocoder, calls } = harness({ options: { cacheMaxEntries: 2, minIntervalMs: 0 } });
    await geocoder.search("a1x");
    await geocoder.search("b2x");
    await geocoder.search("a1x"); // refresh a1x
    await geocoder.search("c3x"); // evicts b2x
    assert.equal(calls.length, 3);
    await geocoder.search("a1x");
    assert.equal(calls.length, 3);
    await geocoder.search("b2x");
    assert.equal(calls.length, 4);
  });

  it("coalesces identical concurrent queries into one provider call", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const { geocoder, calls } = harness({
      fetchImpl: async () => { await gate; return jsonResponse([{ lat: "1", lon: "1", display_name: "X" }]); },
    });
    const a = geocoder.search("same query");
    const b = geocoder.search("Same  Query");
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(calls.length, 1);
    assert.deepEqual(ra, rb);
  });

  it("spaces distinct provider calls by minIntervalMs (application-wide)", async () => {
    const { geocoder, sleeps } = harness({ options: { minIntervalMs: 1100 } });
    await geocoder.search("one");
    await geocoder.search("two");
    await geocoder.search("three");
    assert.deepEqual(sleeps, [1100, 1100]);
  });

  it("rejects with TOO_MANY_REQUESTS when the wait queue is full, without calling the provider", async () => {
    let calls = 0;
    const slowSleep = () => new Promise(() => {}); // never resolves: queue stays occupied
    const geocoder = createGeocoder({
      baseUrl: "https://geo.example",
      userAgent: "ua",
      attribution: ATTRIBUTION,
      maxQueued: 2,
      minIntervalMs: 1000,
      now: () => 0,
      sleep: slowSleep,
      fetchImpl: async () => { calls += 1; return jsonResponse([]); },
    });
    void geocoder.search("q-first"); // takes slot 0, runs immediately
    await new Promise((r) => setImmediate(r));
    void geocoder.search("q-wait1"); // queued
    void geocoder.search("q-wait2"); // queued
    await assert.rejects(() => geocoder.search("q-wait3"), { code: "TOO_MANY_REQUESTS" });
    assert.equal(calls, 1);
  });
});
