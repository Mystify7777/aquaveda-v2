import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";
import { Issue } from "../src/models/Issue.js";
import { setupTestDb, teardownTestDb, clearCollections, fakeActor, validPoint } from "./helpers/testDb.js";

/**
 * Integration tests for GET /api/v1/issues — paginated issue listing.
 *
 * Uses the same dependency-free HTTP test client pattern as
 * auth.routes.test.js (raw node:http, no supertest). Tests run against
 * a real MongoDB instance (TEST_MONGO_URI), not mocks.
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

function request(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}${path}`,
      { method },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          let body;
          try {
            body = JSON.parse(rawBody);
          } catch {
            body = rawBody;
          }
          resolve({ status: res.statusCode, body, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Seed helper — creates `count` issues in the database with distinct
 * titles. Each issue uses the same actor/location for simplicity; the
 * pagination tests care about counts and ordering, not field variety.
 */
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
  // ── Default pagination ────────────────────────────────────────────

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

  // ── Custom pagination values ──────────────────────────────────────

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

      // seedIssues creates issues with increasing createdAt timestamps,
      // so the last-created issue should appear first in the response.
      assert.equal(body.data[0].title, "Issue 5");
      assert.equal(body.data[4].title, "Issue 1");
    });
  });

  // ── Pagination metadata accuracy ──────────────────────────────────

  describe("pagination metadata accuracy", () => {
    it("calculates totalPages and hasNextPage correctly for 25 items", async () => {
      await seedIssues(25);
      const { body } = await request("GET", "/api/v1/issues?limit=10");

      assert.equal(body.pagination.totalCount, 25);
      assert.equal(body.pagination.totalPages, 3);
      assert.equal(body.pagination.hasNextPage, true);
      assert.equal(body.pagination.hasPrevPage, false);
    });

    it("returns empty data for a page beyond the last page", async () => {
      await seedIssues(5);
      const { status, body } = await request("GET", "/api/v1/issues?page=999&limit=10");

      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.data.length, 0);
      assert.equal(body.pagination.totalCount, 5);
      assert.equal(body.pagination.hasNextPage, false);
      assert.equal(body.pagination.hasPrevPage, true);
    });
  });

  // ── Max limit enforcement ─────────────────────────────────────────

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

  // ── Invalid query parameters ──────────────────────────────────────

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

    it("rejects fractional page", async () => {
      const { status, body } = await request("GET", "/api/v1/issues?page=1.5");

      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(body.code, "VALIDATION_FAILED");
    });

    it("rejects fractional limit", async () => {
      const { status, body } = await request("GET", "/api/v1/issues?limit=2.7");

      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.equal(body.code, "VALIDATION_FAILED");
    });
  });

  // ── Response shape ────────────────────────────────────────────────

  describe("response envelope shape", () => {
    it("includes all expected pagination fields", async () => {
      await seedIssues(1);
      const { body } = await request("GET", "/api/v1/issues");

      assert.equal(typeof body.success, "boolean");
      assert.equal(Array.isArray(body.data), true);
      assert.equal(typeof body.pagination, "object");
      assert.equal(typeof body.pagination.page, "number");
      assert.equal(typeof body.pagination.limit, "number");
      assert.equal(typeof body.pagination.totalCount, "number");
      assert.equal(typeof body.pagination.totalPages, "number");
      assert.equal(typeof body.pagination.hasNextPage, "boolean");
      assert.equal(typeof body.pagination.hasPrevPage, "boolean");
    });

    it("returns issue documents with expected fields", async () => {
      await seedIssues(1);
      const { body } = await request("GET", "/api/v1/issues");
      const issue = body.data[0];

      assert.ok(issue._id);
      assert.ok(issue.title);
      assert.ok(issue.description);
      assert.ok(issue.location);
      assert.ok(issue.status);
      assert.ok(issue.createdAt);
    });
  });
});
