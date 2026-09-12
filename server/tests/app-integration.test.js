import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * Integration tests for app.js's router mounting (Phase 7) and global
 * 404 normalization (Phase 8). Uses the real createApp() — this is the
 * one test file that exercises the fully-assembled app (all 5 routers
 * mounted together), rather than a single router in isolation like
 * issue/knowledge/comment/project.routes.test.js.
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
  await new Promise((resolve) => server.close(resolve));
  await teardownTestDb();
});

beforeEach(clearCollections);

function request(method, path, { body } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {};
    if (bodyStr !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(`${baseUrl}${path}`, { method, headers }, (res) => {
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
      body: { title: "x", description: "y", location: { type: "Point", coordinates: [0, 0] } },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("reaches knowledgeRouter through the fully-assembled app", async () => {
    const res = await request("POST", "/api/v1/knowledge", { body: { title: "x", body: "y" } });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("reaches commentRouter through the fully-assembled app", async () => {
    const res = await request("POST", "/api/v1/comments", {
      body: { refType: "ISSUE", refId: "507f1f77bcf86cd799439011", body: "x" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("reaches projectRouter through the fully-assembled app", async () => {
    const res = await request("POST", "/api/v1/projects", {
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
});
