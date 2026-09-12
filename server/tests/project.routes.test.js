import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { projectRouter } from "../src/routes/project.routes.js";
import { createIssue } from "../src/services/issue.service.js";
import { Issue } from "../src/models/Issue.js";
import { register } from "../src/services/auth.service.js";
import { setupTestDb, teardownTestDb, clearCollections, fakeActor, validPoint } from "./helpers/testDb.js";

/**
 * Focused HTTP tests for project.routes.js.
 *
 * Same local-test-app pattern as the other 3 route test files. The
 * originating Issue is created directly via the service layer, then
 * moved to an eligible status via a direct Issue.updateOne — legal
 * here because createProject only ever reads `issue.status`, never
 * `statusHistory` (confirmed by direct read of project.service.js;
 * unlike issue.service.test.js's forceStatus fixture, no full history
 * chain is required for this to be a valid test setup).
 */

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/v1/projects", projectRouter);
  return app;
}

let server;
let baseUrl;

before(async () => {
  await setupTestDb();
  const app = buildTestApp();
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

function request(method, path, { body, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {};
    if (bodyStr !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }
    if (cookies) {
      headers["Cookie"] = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
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

const VALID_PASSWORD = "correcthorsebatterystaple";

async function makeAuthedUser() {
  return register({
    name: "Test User",
    email: `user-${Date.now()}-${Math.random()}@example.com`,
    password: VALID_PASSWORD,
  });
}

function authCookie(accessToken) {
  return { [ACCESS_TOKEN_COOKIE_NAME]: accessToken };
}

async function makeEligibleIssue(status = "acknowledged") {
  const issue = await createIssue(fakeActor("USER"), {
    title: "Leaking pipe",
    description: "d",
    location: validPoint(),
  });
  await Issue.updateOne({ _id: issue._id }, { $set: { status } });
  return issue;
}

describe("POST /api/v1/projects", () => {
  it("201s for an eligible originIssue status, with the complete canonical envelope (ROUTE-L6)", async () => {
    const { accessToken } = await makeAuthedUser();
    const issue = await makeEligibleIssue("acknowledged");

    const res = await request("POST", "/api/v1/projects", {
      cookies: authCookie(accessToken),
      body: {
        title: "Community pipe repair",
        description: "Coordinated repair effort",
        originIssue: String(issue._id),
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.success, true);
    assert.equal(typeof res.json.message, "string");
    assert.ok(res.json.message.length > 0);
    assert.equal(res.json.data.title, "Community pipe repair");
    assert.equal(Object.keys(res.json).sort().join(","), "data,message,success");
  });

  it("400s with VALIDATION_FAILED for a missing originIssue (distinct from a malformed one)", async () => {
    const { accessToken } = await makeAuthedUser();
    const res = await request("POST", "/api/v1/projects", {
      cookies: authCookie(accessToken),
      body: { title: "t", description: "d" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
    assert.equal(res.json.data, null);
  });

  it("400s with VALIDATION_FAILED for a malformed originIssue", async () => {
    const { accessToken } = await makeAuthedUser();
    const res = await request("POST", "/api/v1/projects", {
      cookies: authCookie(accessToken),
      body: { title: "t", description: "d", originIssue: "not-an-object-id" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("401s for an anonymous request", async () => {
    const issue = await makeEligibleIssue("acknowledged");
    const res = await request("POST", "/api/v1/projects", {
      body: { title: "t", description: "d", originIssue: String(issue._id) },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("404s with NOT_FOUND for a well-formed but nonexistent originIssue", async () => {
    const { accessToken } = await makeAuthedUser();
    const res = await request("POST", "/api/v1/projects", {
      cookies: authCookie(accessToken),
      body: { title: "t", description: "d", originIssue: "507f1f77bcf86cd799439011" },
    });

    assert.equal(res.status, 404);
    assert.equal(res.json.code, "NOT_FOUND");
  });

  it("409s with INVALID_STATE for an ineligible originIssue status (open)", async () => {
    const { accessToken } = await makeAuthedUser();
    const issue = await createIssue(fakeActor("USER"), {
      title: "Still open",
      description: "d",
      location: validPoint(),
    });

    const res = await request("POST", "/api/v1/projects", {
      cookies: authCookie(accessToken),
      body: { title: "t", description: "d", originIssue: String(issue._id) },
    });

    assert.equal(res.status, 409);
    assert.equal(res.json.code, "INVALID_STATE");
  });
});
