import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { issueRouter } from "../src/routes/issue.routes.js";
import { User } from "../src/models/User.js";
import { register } from "../src/services/auth.service.js";
import { signAccessToken } from "../src/services/auth-tokens.js";
import { Issue } from "../src/models/Issue.js";
import { setupTestDb, teardownTestDb, clearCollections, validPoint } from "./helpers/testDb.js";

/**
 * Focused HTTP tests for issue.routes.js (routes-implementation-plan.md
 * Phase 3).
 *
 * issueRouter is NOT yet mounted into src/app.js's createApp() — that's
 * Phase 7's job, deliberately later. This file builds its own minimal
 * Express app (json -> cookie-parser -> authMiddleware -> issueRouter)
 * so the router can be tested in real HTTP isolation before app-wide
 * integration, mirroring auth.routes.test.js's node:http-based request
 * helper but assembling the app locally instead of importing createApp().
 */

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/v1/issues", issueRouter);
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
          // non-JSON body, leave json as null
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

/**
 * Creates a real User via the auth service (so authMiddleware's fresh
 * DB role-lookup has something real to find) and mints a real access
 * token for it — the same pattern auth.middleware.test.js already
 * established for testing role-dependent behavior against a real HTTP
 * boundary rather than a hand-built actorContext.
 */
async function makeAuthedUser(role = "USER", overrides = {}) {
  const { user, accessToken } = await register({
    name: "Test User",
    email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@example.com`,
    password: VALID_PASSWORD,
    ...overrides,
  });
  if (role !== "USER") {
    await User.updateOne({ _id: user.id }, { $set: { role } });
  }
  return { user, accessToken };
}

function authCookie(accessToken) {
  return { [ACCESS_TOKEN_COOKIE_NAME]: accessToken };
}

describe("POST /api/v1/issues", () => {
  it("201s and returns the created Issue in the complete canonical envelope (ROUTE-L6)", async () => {
    const { accessToken } = await makeAuthedUser("USER");
    const res = await request("POST", "/api/v1/issues", {
      cookies: authCookie(accessToken),
      body: {
        title: "Leaking pipe",
        description: "Water pooling near the market",
        location: validPoint(),
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.title, "Leaking pipe");
    assert.equal(res.json.data.status, "open");
    assert.equal(typeof res.json.message, "string");
    assert.ok(res.json.message.length > 0);
    assert.equal(Object.keys(res.json).sort().join(","), "data,message,success");
  });

  it("400s with VALIDATION_FAILED for a missing title, with the complete canonical failure envelope (ROUTE-L6)", async () => {
    const { accessToken } = await makeAuthedUser("USER");
    const res = await request("POST", "/api/v1/issues", {
      cookies: authCookie(accessToken),
      body: { description: "no title here", location: validPoint() },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.equal(res.json.data, null);
    assert.equal(typeof res.json.message, "string");
    assert.ok(res.json.message.length > 0);
    assert.equal(res.json.code, "VALIDATION_FAILED");
    assert.equal(Object.keys(res.json).sort().join(","), "code,data,message,success");
  });

  it("401s with UNAUTHORIZED for an anonymous request (no cookie)", async () => {
    const res = await request("POST", "/api/v1/issues", {
      body: {
        title: "Leaking pipe",
        description: "Water pooling near the market",
        location: validPoint(),
      },
    });

    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });
});

describe("PATCH /api/v1/issues/:issueId/status", () => {
  async function makeOpenIssue(accessToken) {
    const res = await request("POST", "/api/v1/issues", {
      cookies: authCookie(accessToken),
      body: {
        title: "Leaking pipe",
        description: "Water pooling near the market",
        location: validPoint(),
      },
    });
    return res.json.data;
  }

  it("200s on a valid EXPERT-authorized transition (open -> acknowledged)", async () => {
    const reporter = await makeAuthedUser("USER");
    const expert = await makeAuthedUser("EXPERT");
    const issue = await makeOpenIssue(reporter.accessToken);

    const res = await request("PATCH", `/api/v1/issues/${issue._id}/status`, {
      cookies: authCookie(expert.accessToken),
      body: { targetStatus: "acknowledged" },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.status, "acknowledged");
  });

  it("400s with VALIDATION_FAILED for an unrecognized targetStatus", async () => {
    const reporter = await makeAuthedUser("USER");
    const issue = await makeOpenIssue(reporter.accessToken);

    const res = await request("PATCH", `/api/v1/issues/${issue._id}/status`, {
      cookies: authCookie(reporter.accessToken),
      body: { targetStatus: "not_a_real_status" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("403s with FORBIDDEN when a non-EXPERT attempts open -> acknowledged", async () => {
    const reporter = await makeAuthedUser("USER");
    const issue = await makeOpenIssue(reporter.accessToken);

    const res = await request("PATCH", `/api/v1/issues/${issue._id}/status`, {
      cookies: authCookie(reporter.accessToken),
      body: { targetStatus: "acknowledged" },
    });

    assert.equal(res.status, 403);
    assert.equal(res.json.code, "FORBIDDEN");
  });

  it("404s with NOT_FOUND for a well-formed but nonexistent issueId", async () => {
    const expert = await makeAuthedUser("EXPERT");
    const fakeId = "507f1f77bcf86cd799439011";

    const res = await request("PATCH", `/api/v1/issues/${fakeId}/status`, {
      cookies: authCookie(expert.accessToken),
      body: { targetStatus: "acknowledged" },
    });

    assert.equal(res.status, 404);
    assert.equal(res.json.code, "NOT_FOUND");
  });

  it("400s with VALIDATION_FAILED (CastError translation) for a malformed issueId", async () => {
    const expert = await makeAuthedUser("EXPERT");

    const res = await request("PATCH", "/api/v1/issues/not-a-valid-object-id/status", {
      cookies: authCookie(expert.accessToken),
      body: { targetStatus: "acknowledged" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("409s with AUTHORIZATION_POLICY_UNRESOLVED (never 403) for the D-3a-gated acknowledged -> in_progress transition", async () => {
    const expert = await makeAuthedUser("EXPERT");
    const issue = await makeOpenIssue(expert.accessToken);

    // Move to acknowledged first (a legal, EXPERT-authorized transition).
    await request("PATCH", `/api/v1/issues/${issue._id}/status`, {
      cookies: authCookie(expert.accessToken),
      body: { targetStatus: "acknowledged" },
    });

    const res = await request("PATCH", `/api/v1/issues/${issue._id}/status`, {
      cookies: authCookie(expert.accessToken),
      body: { targetStatus: "in_progress" },
    });

    assert.equal(res.status, 409);
    assert.notEqual(res.status, 403);
    assert.equal(res.json.code, "AUTHORIZATION_POLICY_UNRESOLVED");
    assert.equal(res.json.success, false);
    assert.equal(res.json.data, null);
  });

  it("409s with STATE_RACE style envelope on a genuinely illegal transition (open -> verified)", async () => {
    const expert = await makeAuthedUser("EXPERT");
    const issue = await makeOpenIssue(expert.accessToken);

    const res = await request("PATCH", `/api/v1/issues/${issue._id}/status`, {
      cookies: authCookie(expert.accessToken),
      body: { targetStatus: "verified" },
    });

    assert.equal(res.status, 409);
    assert.equal(res.json.code, "INVALID_STATE");
  });
});
