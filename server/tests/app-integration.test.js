import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import { register } from "../src/services/auth.service.js";
import { Issue } from "../src/models/Issue.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";

/**
 * Integration tests for app.js's router mounting (Phase 7) and global
 * 404 normalization (Phase 8). Uses the real createApp() — this is the
 * one test file that exercises the fully-assembled app (all 5 routers
 * mounted together), rather than a single router in isolation like
 * issue/knowledge/comment/project.routes.test.js.
 */

let server;
let baseUrl;
const ALLOWED_ORIGIN = "http://allowed.example.com";
const DISALLOWED_ORIGIN = "http://disallowed.example.com";

before(async () => {
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;
  await setupTestDb();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardownTestDb();
});

beforeEach(clearCollections);

function request(method, path, { body, headers = {}, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const requestHeaders = { ...headers };
    if (bodyStr !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
      requestHeaders["Content-Length"] = Buffer.byteLength(bodyStr);
    }
    if (cookies) {
      requestHeaders.Cookie = Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    }

    const req = http.request(`${baseUrl}${path}`, { method, headers: requestHeaders }, (res) => {
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
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

describe("global 404 (ROUTE-L6 envelope conformance)", () => {
  it("404s with the complete canonical failure envelope for an unmatched route", async () => {
    const res = await request("GET", "/api/v1/this-route-does-not-exist");

    assert.equal(res.status, 404);
    assert.equal(res.json.success, false);
    assert.equal(res.json.data, null);
    assert.equal(res.json.code, "NOT_FOUND");
    assert.equal(typeof res.json.message, "string");
    assert.equal(Object.keys(res.json).sort().join(","), "code,data,message,success");
  });
});

describe("full app router mounting (Phase 7)", () => {
  it("keeps the session probe publicly readable for an anonymous browser", async () => {
    const res = await request("GET", "/api/v1/auth/me");

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.user, null);
  });

  it("reaches issueRouter through the fully-assembled app (401 for anonymous create — proves the router is wired, not testing Issue logic itself)", async () => {
    const res = await request("POST", "/api/v1/issues", {
      headers: { Origin: ALLOWED_ORIGIN },
      body: { title: "x", description: "y", location: { type: "Point", coordinates: [0, 0] } },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  describe("fail-closed CSRF provenance for Issue creation", () => {
    async function createAuthenticatedUser() {
      return register({
        name: "CSRF Integration User",
        email: `csrf-${Date.now()}-${Math.random()}@example.com`,
        password: "correcthorsebatterystaple",
      });
    }

    const issueBody = {
      title: "Blocked mutation",
      description: "This should only persist for an allowed origin.",
      location: { type: "Point", coordinates: [77.5, 12.9] },
    };

    it("rejects disallowed Origin and Referer before the mutation handler runs", async () => {
      const { accessToken } = await createAuthenticatedUser();

      for (const headers of [
        { Origin: DISALLOWED_ORIGIN },
        { Referer: `${DISALLOWED_ORIGIN}/account` },
      ]) {
        const res = await request("POST", "/api/v1/issues", {
          headers,
          cookies: { [ACCESS_TOKEN_COOKIE_NAME]: accessToken },
          body: issueBody,
        });
        assert.equal(res.status, 403);
        assert.equal(res.json.code, "FORBIDDEN");
      }

      assert.equal(await Issue.countDocuments(), 0);
    });

    it("allows an exact configured Origin to reach the mutation handler", async () => {
      const { accessToken } = await createAuthenticatedUser();
      const res = await request("POST", "/api/v1/issues", {
        headers: { Origin: ALLOWED_ORIGIN },
        cookies: { [ACCESS_TOKEN_COOKIE_NAME]: accessToken },
        body: issueBody,
      });

      assert.equal(res.status, 201);
      assert.equal(res.json.success, true);
      assert.equal(await Issue.countDocuments(), 1);
    });

    it("rejects a state-changing request with neither Origin nor Referer", async () => {
      const { accessToken } = await createAuthenticatedUser();
      const res = await request("POST", "/api/v1/issues", {
        cookies: { [ACCESS_TOKEN_COOKIE_NAME]: accessToken },
        body: issueBody,
      });

      assert.equal(res.status, 403);
      assert.equal(res.json.code, "FORBIDDEN");
      assert.equal(await Issue.countDocuments(), 0);
    });

    it("rejects every state-changing request when ALLOWED_ORIGINS is empty", async () => {
      const previousAllowedOrigins = process.env.ALLOWED_ORIGINS;
      process.env.ALLOWED_ORIGINS = "";
      try {
        const { accessToken } = await createAuthenticatedUser();
        const res = await request("POST", "/api/v1/issues", {
          headers: { Origin: ALLOWED_ORIGIN },
          cookies: { [ACCESS_TOKEN_COOKIE_NAME]: accessToken },
          body: issueBody,
        });

        assert.equal(res.status, 403);
        assert.equal(res.json.code, "FORBIDDEN");
        assert.equal(await Issue.countDocuments(), 0);
      } finally {
        process.env.ALLOWED_ORIGINS = previousAllowedOrigins;
      }
    });
  });

  it("reaches knowledgeRouter through the fully-assembled app", async () => {
    const res = await request("POST", "/api/v1/knowledge", {
      headers: { Origin: ALLOWED_ORIGIN },
      body: { title: "x", body: "y" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("reaches commentRouter through the fully-assembled app", async () => {
    const res = await request("POST", "/api/v1/comments", {
      headers: { Origin: ALLOWED_ORIGIN },
      body: { refType: "ISSUE", refId: "507f1f77bcf86cd799439011", body: "x" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("reaches projectRouter through the fully-assembled app", async () => {
    const res = await request("POST", "/api/v1/projects", {
      headers: { Origin: ALLOWED_ORIGIN },
      body: { title: "x", description: "y", originIssue: "507f1f77bcf86cd799439011" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("the pre-existing health check route is unaffected by the Routes milestone", async () => {
    const res = await request("GET", "/api/v1/health");
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "ok");
  });

  it("includes a valid ISO-8601 timestamp while preserving the health response", async () => {
    const res = await request("GET", "/api/v1/health");

    assert.equal(res.status, 200);
    assert.equal(res.json.status, "ok");
    assert.deepEqual(Object.keys(res.json).sort(), ["status", "timestamp"]);
    assert.equal(typeof res.json.timestamp, "string");
    assert.equal(new Date(res.json.timestamp).toISOString(), res.json.timestamp);
  });
});
