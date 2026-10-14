import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * Integration tests for auth-endpoint rate limiting (Issue #42).
 *
 * Spins up the real Express app (same pattern as auth.routes.test.js)
 * and verifies that the rate limiter actually rejects requests at the
 * HTTP level with the correct status, headers, and canonical error
 * envelope.
 *
 * These tests require a running MongoDB instance (TEST_MONGO_URI).
 */

let server;
let baseUrl;

before(async () => {
  await setupTestDb();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await teardownTestDb();
});

beforeEach(clearCollections);

/**
 * Minimal HTTP client — same pattern used by auth.routes.test.js.
 * Deliberately not using supertest (no unscoped dependencies).
 */
function request(method, path, { body, cookies, headers: extraHeaders } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = { ...extraHeaders };
    if (bodyStr !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }
    if (cookies) {
      headers["Cookie"] = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }

    const req = http.request(
      `${baseUrl}${path}`,
      { method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = rawBody ? JSON.parse(rawBody) : null;
          } catch {
            // non-JSON body
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            json,
          });
        });
      }
    );
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

describe("Rate limiting — POST /api/v1/auth/login integration", () => {
  it("returns 429 with canonical error envelope after exceeding the login rate limit", async () => {
    // The login limiter allows 10 requests per 60s window.
    // First, register a user so login attempts are valid shape-wise.
    await request("POST", "/api/v1/auth/register", {
      body: {
        name: "Rate Test",
        email: "rate@test.com",
        password: "correcthorsebatterystaple",
      },
    });

    // Fire 10 requests (all allowed, regardless of credentials correctness).
    for (let i = 0; i < 10; i++) {
      await request("POST", "/api/v1/auth/login", {
        body: { email: "rate@test.com", password: "wrong" },
      });
    }

    // The 11th request should be rate-limited.
    const res = await request("POST", "/api/v1/auth/login", {
      body: { email: "rate@test.com", password: "wrong" },
    });

    assert.equal(res.status, 429);
    assert.equal(res.json.success, false);
    assert.equal(res.json.data, null);
    assert.equal(res.json.code, "TOO_MANY_REQUESTS");
    assert.equal(typeof res.json.message, "string");
    assert.ok(res.json.message.length > 0);
    assert.equal(Object.keys(res.json).sort().join(","), "code,data,message,success");

    // Standard rate-limit headers must be present.
    assert.ok(res.headers["retry-after"], "Retry-After header must be present");
    assert.ok(res.headers["x-ratelimit-limit"], "X-RateLimit-Limit must be present");
    assert.ok(res.headers["x-ratelimit-remaining"], "X-RateLimit-Remaining must be present");
    assert.ok(res.headers["x-ratelimit-reset"], "X-RateLimit-Reset must be present");

    assert.equal(res.headers["x-ratelimit-remaining"], "0");
  });

  it("rate limiting does not affect /me or /logout", async () => {
    // Saturate /login to prove the rate limiter is active.
    for (let i = 0; i < 10; i++) {
      await request("POST", "/api/v1/auth/login", {
        body: { email: "nobody@test.com", password: "whatever123" },
      });
    }

    // /me and /logout should still work — they are not rate-limited.
    const meRes = await request("GET", "/api/v1/auth/me");
    assert.equal(meRes.status, 200);

    const logoutRes = await request("POST", "/api/v1/auth/logout");
    assert.equal(logoutRes.status, 200);
  });
});

describe("Rate limiting — POST /api/v1/auth/register integration", () => {
  it("returns 429 after exceeding the register rate limit (5 requests)", async () => {
    // Fire 5 registration requests (they'll fail on duplicate after the
    // first, but the rate limiter counts them all the same).
    for (let i = 0; i < 5; i++) {
      await request("POST", "/api/v1/auth/register", {
        body: {
          name: `User ${i}`,
          email: `user${i}@test.com`,
          password: "correcthorsebatterystaple",
        },
      });
    }

    // The 6th should be rate-limited.
    const res = await request("POST", "/api/v1/auth/register", {
      body: {
        name: "User 5",
        email: "user5@test.com",
        password: "correcthorsebatterystaple",
      },
    });

    assert.equal(res.status, 429);
    assert.equal(res.json.success, false);
    assert.equal(res.json.data, null);
    assert.equal(res.json.code, "TOO_MANY_REQUESTS");
    assert.equal(typeof res.json.message, "string");
    assert.ok(res.json.message.length > 0);
    assert.equal(Object.keys(res.json).sort().join(","), "code,data,message,success");
    assert.ok(res.headers["retry-after"], "Retry-After header must be present");
  });
});

describe("Rate limiting — POST /api/v1/auth/refresh integration", () => {
  it("returns 429 after exceeding the refresh rate limit (10 requests)", async () => {
    // Fire 10 refresh requests (unauthenticated, so 401s, but counted by rate limiter).
    for (let i = 0; i < 10; i++) {
      await request("POST", "/api/v1/auth/refresh");
    }

    // The 11th request should be rate-limited.
    const res = await request("POST", "/api/v1/auth/refresh");

    assert.equal(res.status, 429);
    assert.equal(res.json.success, false);
    assert.equal(res.json.data, null);
    assert.equal(res.json.code, "TOO_MANY_REQUESTS");
    assert.equal(typeof res.json.message, "string");
    assert.ok(res.json.message.length > 0);
    assert.equal(Object.keys(res.json).sort().join(","), "code,data,message,success");
    assert.ok(res.headers["retry-after"], "Retry-After header must be present");
    assert.equal(res.headers["x-ratelimit-remaining"], "0");
  });
});
