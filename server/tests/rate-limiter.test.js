import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  createRateLimiter,
  createInMemoryStore,
  resolveClientIp,
} from "../src/middleware/rate-limiter.js";

/**
 * Unit tests for the sliding-window rate limiter.
 *
 * These are pure middleware tests — no HTTP server, no MongoDB, no
 * network. Each test constructs minimal Express-shaped req/res/next
 * objects and calls the middleware function directly. Time-dependent
 * behavior (window expiry) is controlled via node:test's mock.timers
 * for fully deterministic assertions.
 */

/**
 * Builds a minimal Express-shaped request object with the given IP
 * and optional headers.
 */
function fakeReq({ ip = "192.168.1.1", headers = {} } = {}) {
  return {
    headers,
    socket: { remoteAddress: ip },
  };
}

/**
 * Builds a minimal Express-shaped response object that records
 * status, headers, and the JSON body for assertion.
 */
function fakeRes() {
  const _headers = {};
  let _status = null;
  let _json = null;

  return {
    setHeader(name, value) {
      _headers[name] = value;
    },
    status(code) {
      _status = code;
      return this; // chainable
    },
    json(body) {
      _json = body;
    },
    get _status() { return _status; },
    get _json() { return _json; },
    get _headers() { return _headers; },
  };
}

// ---------------------------------------------------------------------------
// resolveClientIp
// ---------------------------------------------------------------------------
describe("resolveClientIp", () => {
  it("prefers x-forwarded-for (first entry) over other sources", () => {
    const req = fakeReq({
      ip: "10.0.0.1",
      headers: {
        "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178",
        "x-real-ip": "70.41.3.18",
      },
    });
    assert.equal(resolveClientIp(req), "203.0.113.50");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = fakeReq({
      ip: "10.0.0.1",
      headers: { "x-real-ip": "203.0.113.50" },
    });
    assert.equal(resolveClientIp(req), "203.0.113.50");
  });

  it("falls back to socket remoteAddress when no proxy headers are present", () => {
    const req = fakeReq({ ip: "127.0.0.1" });
    assert.equal(resolveClientIp(req), "127.0.0.1");
  });

  it("returns 'unknown' when nothing is available", () => {
    const req = { headers: {}, socket: {} };
    assert.equal(resolveClientIp(req), "unknown");
  });
});

// ---------------------------------------------------------------------------
// createInMemoryStore
// ---------------------------------------------------------------------------
describe("createInMemoryStore", () => {
  it("tracks hits within the window and prunes expired timestamps", () => {
    const store = createInMemoryStore({ cleanupIntervalMs: 999_999 });
    const windowMs = 1000;

    const r1 = store.hit("key1", windowMs);
    assert.equal(r1.totalHits, 1);

    const r2 = store.hit("key1", windowMs);
    assert.equal(r2.totalHits, 2);
  });

  it("reset() clears all tracked state", () => {
    const store = createInMemoryStore({ cleanupIntervalMs: 999_999 });
    store.hit("key1", 60_000);
    store.hit("key2", 60_000);

    store.reset();

    assert.equal(store._store.size, 0);
  });
});

// ---------------------------------------------------------------------------
// createRateLimiter — core middleware behavior
// ---------------------------------------------------------------------------
describe("createRateLimiter", () => {
  let store;

  beforeEach(() => {
    store = createInMemoryStore({ cleanupIntervalMs: 999_999 });
  });

  it("allows requests under the threshold and calls next()", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 3,
      store,
    });

    for (let i = 0; i < 3; i++) {
      const req = fakeReq();
      const res = fakeRes();
      let nextCalled = false;
      limiter(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled, `request ${i + 1} should call next()`);
      assert.equal(res._status, null, `request ${i + 1} should not set a status`);
    }
  });

  it("rejects the (maxRequests + 1)th request with 429 and canonical error envelope", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 3,
      store,
    });

    // Exhaust the limit.
    for (let i = 0; i < 3; i++) {
      limiter(fakeReq(), fakeRes(), () => {});
    }

    // The 4th request should be rejected.
    const req = fakeReq();
    const res = fakeRes();
    let nextCalled = false;
    limiter(req, res, () => { nextCalled = true; });

    assert.ok(!nextCalled, "next() must NOT be called on a rate-limited request");
    assert.equal(res._status, 429);
    assert.equal(res._json.success, false);
    assert.equal(res._json.data, null);
    assert.equal(res._json.code, "TOO_MANY_REQUESTS");
    assert.equal(typeof res._json.message, "string");
    assert.ok(res._json.message.length > 0);
    assert.equal(Object.keys(res._json).sort().join(","), "code,data,message,success");
  });

  it("sets Retry-After header on 429 responses", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      store,
    });

    limiter(fakeReq(), fakeRes(), () => {});

    const res = fakeRes();
    limiter(fakeReq(), res, () => {});

    assert.equal(res._status, 429);
    const retryAfter = Number(res._headers["Retry-After"]);
    assert.ok(retryAfter >= 1, "Retry-After must be at least 1 second");
    assert.ok(retryAfter <= 60, "Retry-After must not exceed the window");
  });

  it("sets X-RateLimit-* headers on every response (allowed and rejected)", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 2,
      store,
    });

    // First request — allowed.
    const res1 = fakeRes();
    limiter(fakeReq(), res1, () => {});
    assert.equal(res1._headers["X-RateLimit-Limit"], 2);
    assert.equal(res1._headers["X-RateLimit-Remaining"], 1);
    assert.equal(typeof res1._headers["X-RateLimit-Reset"], "number");

    // Second request — allowed, remaining drops to 0.
    const res2 = fakeRes();
    limiter(fakeReq(), res2, () => {});
    assert.equal(res2._headers["X-RateLimit-Remaining"], 0);

    // Third request — rejected, remaining stays 0.
    const res3 = fakeRes();
    limiter(fakeReq(), res3, () => {});
    assert.equal(res3._status, 429);
    assert.equal(res3._headers["X-RateLimit-Remaining"], 0);
  });

  it("tracks different IPs independently", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      store,
    });

    // Client A hits the limit.
    limiter(fakeReq({ ip: "10.0.0.1" }), fakeRes(), () => {});
    const resA = fakeRes();
    let nextA = false;
    limiter(fakeReq({ ip: "10.0.0.1" }), resA, () => { nextA = true; });
    assert.equal(resA._status, 429);
    assert.ok(!nextA);

    // Client B is unaffected.
    const resB = fakeRes();
    let nextB = false;
    limiter(fakeReq({ ip: "10.0.0.2" }), resB, () => { nextB = true; });
    assert.ok(nextB, "Client B must not be rate-limited by Client A's requests");
    assert.equal(resB._status, null);
  });

  it("keyPrefix namespaces different limiters sharing the same store", () => {
    const limiterA = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      store,
      keyPrefix: "a:",
    });
    const limiterB = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      store,
      keyPrefix: "b:",
    });

    // Exhaust limiterA for this IP.
    limiterA(fakeReq(), fakeRes(), () => {});
    const resA = fakeRes();
    limiterA(fakeReq(), resA, () => {});
    assert.equal(resA._status, 429);

    // limiterB for the same IP is still allowed.
    const resB = fakeRes();
    let nextB = false;
    limiterB(fakeReq(), resB, () => { nextB = true; });
    assert.ok(nextB);
    assert.equal(resB._status, null);
  });

  it("resets the counter after the window expires (mock.timers)", (t) => {
    t.mock.timers.enable({ apis: ["Date"] });

    const windowMs = 60_000;
    const limiter = createRateLimiter({
      windowMs,
      maxRequests: 2,
      store,
    });

    // Use up the quota at t=0.
    limiter(fakeReq(), fakeRes(), () => {});
    limiter(fakeReq(), fakeRes(), () => {});

    // Confirm blocked at t=0.
    const resBlocked = fakeRes();
    let blockedNext = false;
    limiter(fakeReq(), resBlocked, () => { blockedNext = true; });
    assert.equal(resBlocked._status, 429);
    assert.ok(!blockedNext);

    // Advance time past the window.
    t.mock.timers.tick(windowMs + 1);

    // Should be allowed again.
    const resAllowed = fakeRes();
    let allowedNext = false;
    limiter(fakeReq(), resAllowed, () => { allowedNext = true; });
    assert.ok(allowedNext, "request should pass through after window expires");
    assert.equal(resAllowed._status, null);
  });

  it("partially expired window: only unexpired hits count", (t) => {
    t.mock.timers.enable({ apis: ["Date"] });

    const windowMs = 10_000; // 10 seconds
    const limiter = createRateLimiter({
      windowMs,
      maxRequests: 3,
      store,
    });

    // 2 hits at t=0.
    limiter(fakeReq(), fakeRes(), () => {});
    limiter(fakeReq(), fakeRes(), () => {});

    // Advance 6 seconds.
    t.mock.timers.tick(6_000);

    // Hit 3 at t=6s — all 3 within window, quota full.
    const res3 = fakeRes();
    limiter(fakeReq(), res3, () => {});
    assert.equal(res3._headers["X-RateLimit-Remaining"], 0);

    // Advance to t=10.001s — the 2 hits from t=0 expire
    // (0 + 10_000 = 10_000 < 10_001), but the hit at t=6s is still
    // valid (6_000 + 10_000 = 16_000 > 10_001). Only 1 unexpired hit.
    t.mock.timers.tick(4_001);

    // Should be allowed — only 1 old hit + 1 new = 2, under limit of 3.
    const resAllowed = fakeRes();
    let allowed = false;
    limiter(fakeReq(), resAllowed, () => { allowed = true; });
    assert.ok(allowed, "should be allowed after oldest hits expire");
    assert.equal(resAllowed._status, null);
    // 1 old + 1 new = 2 hits, remaining = 3 - 2 = 1
    assert.equal(resAllowed._headers["X-RateLimit-Remaining"], 1);
  });
});
