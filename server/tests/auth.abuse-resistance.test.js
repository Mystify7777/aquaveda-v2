import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";
import { defaultStore } from "../src/middleware/rate-limiter.js";

/**
 * Issue #27 — abuse resistance of the auth endpoints, exercised over real HTTP
 * through the fully assembled app (CSRF guard, CORS, real limiters).
 *
 * DB-free by construction: bodies are chosen so each request is counted by the
 * limiter and then answered (400/401) before any database access.
 *
 * The attack modelled: one client (one socket address) forges the
 * `X-Forwarded-For` / `X-Real-IP` request headers to look like many clients.
 */

const ORIGIN = "https://app.example.test";
const ENDPOINTS = [
  // path, body, limit/min, status returned while under the limit
  { path: "/api/v1/auth/login", body: {}, limit: 10, under: 400 },
  { path: "/api/v1/auth/register", body: {}, limit: 5, under: 400 },
  { path: "/api/v1/auth/refresh", body: undefined, limit: 10, under: 401 },
];

let server;
let base;
const saved = {};

before(async () => {
  saved.origins = process.env.ALLOWED_ORIGINS;
  saved.hops = process.env.TRUSTED_PROXY_HOPS;
  process.env.ALLOWED_ORIGINS = ORIGIN;
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  for (const [k, env] of [["origins", "ALLOWED_ORIGINS"], ["hops", "TRUSTED_PROXY_HOPS"]]) {
    if (saved[k] === undefined) delete process.env[env];
    else process.env[env] = saved[k];
  }
});

beforeEach(() => {
  defaultStore.reset();
  delete process.env.TRUSTED_PROXY_HOPS;
});

async function hit(endpoint, headers = {}) {
  const res = await fetch(base + endpoint.path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: endpoint.body === undefined ? undefined : JSON.stringify(endpoint.body),
  });
  return res.status;
}

async function statuses(endpoint, count, headersFor = () => ({})) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(await hit(endpoint, headersFor(i)));
  return out;
}

describe("limiters cannot be bypassed by forged client-IP headers (default: no trusted proxy)", () => {
  for (const ep of ENDPOINTS) {
    it(`${ep.path}: control — the limit is enforced for a single source`, async () => {
      const s = await statuses(ep, ep.limit + 2);
      assert.deepEqual(s.slice(0, ep.limit), Array(ep.limit).fill(ep.under));
      assert.deepEqual(s.slice(ep.limit), [429, 429]);
    });

    it(`${ep.path}: a rotating forged X-Forwarded-For does not reset the limit`, async () => {
      const s = await statuses(ep, ep.limit + 3, (i) => ({ "x-forwarded-for": `203.0.113.${i + 1}` }));
      assert.deepEqual(s.slice(ep.limit), [429, 429, 429], `statuses: ${s}`);
    });

    it(`${ep.path}: a rotating forged X-Real-IP does not reset the limit`, async () => {
      const s = await statuses(ep, ep.limit + 3, (i) => ({ "x-real-ip": `198.51.100.${i + 1}` }));
      assert.deepEqual(s.slice(ep.limit), [429, 429, 429], `statuses: ${s}`);
    });
  }
});

describe("behind N trusted proxies (TRUSTED_PROXY_HOPS)", () => {
  const login = ENDPOINTS[0];

  it("hops=1: the proxy-appended (last) entry is the client; forged prefixes are ignored", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    // Same real client (198.51.100.7) behind one proxy; attacker rotates the forged prefix.
    const s = await statuses(login, login.limit + 2, (i) => ({
      "x-forwarded-for": `203.0.113.${i + 1}, 198.51.100.7`,
    }));
    assert.deepEqual(s.slice(login.limit), [429, 429], `statuses: ${s}`);
  });

  it("hops=1: different real clients are limited independently (no shared global bucket)", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    for (let i = 0; i < login.limit + 2; i++) {
      assert.equal(await hit(login, { "x-forwarded-for": `198.51.100.${i + 1}` }), 400);
    }
  });

  it("hops=2 with a single forged entry (request did not traverse the chain): limit still holds", async () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    const s = await statuses(login, login.limit + 3, (i) => ({ "x-forwarded-for": `203.0.113.${i + 1}` }));
    assert.deepEqual(s.slice(login.limit), [429, 429, 429], `statuses: ${s}`);
  });
});
