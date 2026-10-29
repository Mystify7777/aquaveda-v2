import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { createGeocodeRouter } from "../src/routes/geocode.routes.js";
import { createRateLimiter, createInMemoryStore } from "../src/middleware/rate-limiter.js";
import { createGeocoder } from "../src/services/geocoder.js";

/**
 * DB-free HTTP tests: actor resolution is replaced by a header-driven stub
 * (the real authMiddleware is covered by auth.middleware.test.js); the
 * provider is a fake fetch. Nothing here touches MongoDB or the network.
 */

const ATTRIBUTION = { text: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" };

function build({ fetchImpl, enabled = true, maxRequests = 100 } = {}) {
  const providerCalls = [];
  const geocoder = createGeocoder({
    baseUrl: "https://geo.example",
    userAgent: "ua",
    attribution: ATTRIBUTION,
    minIntervalMs: 0,
    fetchImpl:
      fetchImpl ??
      (async (url) => {
        providerCalls.push(new URL(url));
        return { ok: true, status: 200, json: async () => [{ lat: "25.6", lon: "85.1", display_name: "Patna, Bihar, India" }] };
      }),
    logger: { warn() {} },
  });
  const app = express();
  app.use((req, _res, next) => {
    req.actorContext = req.get("x-test-actor") ? { id: "507f1f77bcf86cd799439011", role: "USER" } : null;
    next();
  });
  app.use(
    "/api/v1/geocode",
    createGeocodeRouter({
      getGeocoder: () => (enabled ? geocoder : null),
      limiter: createRateLimiter({ windowMs: 60_000, maxRequests, store: createInMemoryStore(), keyPrefix: "t:" }),
    }),
  );
  return { app, providerCalls };
}

async function serve(app) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function get(base, path, { actor = true } = {}) {
  const res = await fetch(`${base}${path}`, { headers: actor ? { "x-test-actor": "1" } : {} });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

describe("GET /api/v1/geocode/search", () => {
  let ctx;
  before(async () => {
    const built = build();
    ctx = { ...built, ...(await serve(built.app)) };
  });
  after(() => new Promise((r) => ctx.server.close(r)));

  it("401 without an actor; the provider is never called", async () => {
    const r = await get(ctx.base, "/api/v1/geocode/search?q=Patna", { actor: false });
    assert.equal(r.status, 401);
    assert.equal(r.body.success, false);
    assert.equal(ctx.providerCalls.length, 0);
  });

  it("400 for missing, too-short and over-long q", async () => {
    for (const q of ["", "?q=", "?q=ab", `?q=${"x".repeat(201)}`]) {
      const path = q.startsWith("?") ? `/api/v1/geocode/search${q}` : "/api/v1/geocode/search";
      const r = await get(ctx.base, path);
      assert.equal(r.status, 400, path.slice(0, 60));
      assert.equal(r.body.code, "VALIDATION_FAILED");
    }
    assert.equal(ctx.providerCalls.length, 0);
  });

  it("400 for repeated q parameters", async () => {
    const r = await get(ctx.base, "/api/v1/geocode/search?q=abc&q=def");
    assert.equal(r.status, 400);
  });

  it("200 with the standard envelope, normalized results and attribution; no-store", async () => {
    const r = await get(ctx.base, "/api/v1/geocode/search?q=%20%20Patna%20%20Junction%20");
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.deepEqual(r.body.data, {
      results: [{ label: "Patna, Bihar, India", latitude: 25.6, longitude: 85.1 }],
      attribution: ATTRIBUTION,
    });
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    assert.equal(ctx.providerCalls.at(-1).searchParams.get("q"), "Patna Junction");
  });
});

describe("GET /api/v1/geocode/search — degradation", () => {
  it("503 GEOCODER_UNAVAILABLE when the provider fails (generic message)", async () => {
    const { app } = build({ fetchImpl: async () => { throw new Error("db password leaked"); } });
    const { server, base } = await serve(app);
    try {
      const r = await get(base, "/api/v1/geocode/search?q=Patna");
      assert.equal(r.status, 503);
      assert.equal(r.body.code, "GEOCODER_UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(r.body), /leaked/);
    } finally {
      await new Promise((res) => server.close(res));
    }
  });

  it("503 when the geocoder is not configured (production default)", async () => {
    const { app } = build({ enabled: false });
    const { server, base } = await serve(app);
    try {
      const r = await get(base, "/api/v1/geocode/search?q=Patna");
      assert.equal(r.status, 503);
      assert.equal(r.body.code, "GEOCODER_UNAVAILABLE");
    } finally {
      await new Promise((res) => server.close(res));
    }
  });

  it("429 after the per-IP limit; Retry-After present", async () => {
    const { app } = build({ maxRequests: 2 });
    const { server, base } = await serve(app);
    try {
      assert.equal((await get(base, "/api/v1/geocode/search?q=Patna")).status, 200);
      assert.equal((await get(base, "/api/v1/geocode/search?q=Patna")).status, 200);
      const r = await get(base, "/api/v1/geocode/search?q=Patna");
      assert.equal(r.status, 429);
      assert.ok(r.headers.get("retry-after"));
    } finally {
      await new Promise((res) => server.close(res));
    }
  });
});
