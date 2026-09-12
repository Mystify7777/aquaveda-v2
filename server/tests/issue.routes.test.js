import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { issueRouter } from "../src/routes/issue.routes.js";
import { User } from "../src/models/User.js";
import { register } from "../src/services/auth.service.js";
import { Issue } from "../src/models/Issue.js";
import { setupTestDb, teardownTestDb, clearCollections, fakeActor, validPoint } from "./helpers/testDb.js";

/**
 * HTTP integration tests for issue.routes.js.
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
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
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
        resolve({ status: res.statusCode, json, body: json });
      });
    });
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

const VALID_PASSWORD = "correcthorsebatterystaple";

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

async function seedIssues(count) {
  const actor = fakeActor();
  const now = Date.now();
  const issues = [];
  for (let i = 0; i < count; i++) {
    issues.push({
      title: `Issue ${i + 1}`,
      description: `Description for issue ${i + 1}`,
      location: validPoint(),
      reportedBy: actor.id,
      status: "open",
      statusHistory: [
        {
          fromStatus: null,
          toStatus: "open",
          actor: actor.id,
          timestamp: new Date(now + i),
        },
      ],
      createdAt: new Date(now + i),
    });
  }
  await Issue.insertMany(issues);
}

describe("GET /api/v1/issues", () => {
  describe("default pagination (no query params)", () => {
    it("returns page 1 with limit 10 by default", async () => {
      await seedIssues(3);
      const { status, body } = await request("GET", "/api/v1/issues");

      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(Array.isArray(body.data), true);
      assert.equal(body.data.length, 3);

      assert.equal(body.pagination.page, 1);
      assert.equal(body.pagination.limit, 10);
      assert.equal(body.pagination.totalCount, 3);
      assert.equal(body.pagination.totalPages, 1);
      assert.equal(body.pagination.hasNextPage, false);
      assert.equal(body.pagination.hasPrevPage, false);
    });

    it("returns an empty array when no issues exist", async () => {
      const { status, body } = await request("GET", "/api/v1/issues");

      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.data.length, 0);
      assert.equal(body.pagination.totalCount, 0);
      assert.equal(body.pagination.totalPages, 0);
      assert.equal(body.pagination.hasNextPage, false);
      assert.equal(body.pagination.hasPrevPage, false);
    });
  });

  describe("custom page and limit", () => {
    it("returns the correct page with custom limit", async () => {
      await seedIssues(12);
      const { status, body } = await request("GET", "/api/v1/issues?page=2&limit=5");

      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.data.length, 5);
      assert.equal(body.pagination.page, 2);
      assert.equal(body.pagination.limit, 5);
      assert.equal(body.pagination.totalCount, 12);
      assert.equal(body.pagination.totalPages, 3);
      assert.equal(body.pagination.hasNextPage, true);
      assert.equal(body.pagination.hasPrevPage, true);
    });

    it("returns the last page correctly", async () => {
      await seedIssues(12);
      const { status, body } = await request("GET", "/api/v1/issues?page=2&limit=10");

      assert.equal(status, 200);
      assert.equal(body.data.length, 2);
      assert.equal(body.pagination.page, 2);
      assert.equal(body.pagination.totalPages, 2);
      assert.equal(body.pagination.hasNextPage, false);
      assert.equal(body.pagination.hasPrevPage, true);
    });

    it("returns issues sorted by createdAt descending (newest first)", async () => {
      await seedIssues(5);
      const { body } = await request("GET", "/api/v1/issues?limit=5");

      assert.equal(body.data[0].title, "Issue 5");
      assert.equal(body.data[4].title, "Issue 1");
    });
  });

  describe("max limit enforcement", () => {
    it("rejects limit above 50", async () => {
      const { status, body } = await request("GET", "/api/v1/issues?limit=100");

      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(body.code, "VALIDATION_FAILED");
      assert.ok(body.message.toLowerCase().includes("limit"));
    });

    it("accepts limit of exactly 50", async () => {
      const { status, body } = await request("GET", "/api/v1/issues?limit=50");

      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.pagination.limit, 50);
    });
  });

  describe("invalid query parameters", () => {
    it("rejects non-numeric page", async () => {
      const { status, body } = await request("GET", "/api/v1/issues?page=abc");

      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(body.code, "VALIDATION_FAILED");
    });

    it("rejects page = 0", async () => {
      const { status, body } = await request("GET", "/api/v1/issues?page=0");

      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(body.code, "VALIDATION_FAILED");
    });

    it("rejects negative page", async () => {
      const { status, body } = await request("GET", "/api/v1/issues?page=-1");

      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(body.code, "VALIDATION_FAILED");
    });

    it("rejects non-numeric limit", async () => {
      const { status, body } = await request("GET", "/api/v1/issues?limit=xyz");

      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(body.code, "VALIDATION_FAILED");
    });

    it("rejects limit = 0", async () => {
      const { status, body } = await request("GET", "/api/v1/issues?limit=0");

      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(body.code, "VALIDATION_FAILED");
    });

    it("rejects negative limit", async () => {
      const { status, body } = await request("GET", "/api/v1/issues?limit=-1");

      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(body.code, "VALIDATION_FAILED");
    });
  });
});

describe("POST /api/v1/issues", () => {
  it("201s and returns the created Issue in the complete canonical envelope", async () => {
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
  });

  it("400s with VALIDATION_FAILED for a missing title", async () => {
    const { accessToken } = await makeAuthedUser("USER");
    const res = await request("POST", "/api/v1/issues", {
      cookies: authCookie(accessToken),
      body: { description: "no title here", location: validPoint() },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.equal(res.json.data, null);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("401s with UNAUTHORIZED for an anonymous request", async () => {
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

  it("200s on a valid EXPERT-authorized transition", async () => {
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
});
