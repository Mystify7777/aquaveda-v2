import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { knowledgeRouter } from "../src/routes/knowledge.routes.js";
import { User } from "../src/models/User.js";
import { register } from "../src/services/auth.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * Issue #74 — HTTP tests for the three workflow reads, plus route-order
 * and public-contract regressions. Same local-app pattern as
 * knowledge.routes.test.js.
 */

let server;
let baseUrl;

before(async () => {
  await setupTestDb();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/v1/knowledge", knowledgeRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardownTestDb();
});

beforeEach(clearCollections);

function request(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {};
    if (bodyStr !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }
    if (token) headers.Cookie = `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
    const req = http.request(`${baseUrl}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
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

let seq = 0;
async function makeUser(role = "USER", name = `Person ${++seq}`) {
  const { user, accessToken } = await register({
    name,
    email: `${role.toLowerCase()}-${seq}-${Date.now()}-${Math.random()}@example.com`,
    password: "correcthorsebatterystaple",
  });
  if (role !== "USER") await User.updateOne({ _id: user.id }, { $set: { role } });
  return { id: String(user.id), token: accessToken };
}

async function draftVia(u, title = "Drip irrigation") {
  const res = await request("POST", "/api/v1/knowledge", {
    token: u.token,
    body: { title, body: `Body of ${title}` },
  });
  return res.json.data;
}

async function pendingVia(u, title) {
  const k = await draftVia(u, title);
  await request("POST", `/api/v1/knowledge/${k._id}/submit`, { token: u.token });
  return k;
}

describe("route order: /mine and /review-queue are not captured by /:knowledgeId", () => {
  it("GET /mine anonymous is 401 from the workflow handler (a captured id would be 400/404)", async () => {
    const res = await request("GET", "/api/v1/knowledge/mine");
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("GET /review-queue anonymous is 401", async () => {
    const res = await request("GET", "/api/v1/knowledge/review-queue");
    assert.equal(res.status, 401);
  });

  it("GET /mine authenticated is 200 with a paginated envelope (not the public :knowledgeId detail)", async () => {
    const me = await makeUser();
    const res = await request("GET", "/api/v1/knowledge/mine", { token: me.token });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.deepEqual(res.json.data, { items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it("GET /review-queue as EXPERT is 200 with a paginated envelope", async () => {
    const expert = await makeUser("EXPERT");
    const res = await request("GET", "/api/v1/knowledge/review-queue", { token: expert.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});

describe("GET /api/v1/knowledge/mine", () => {
  it("returns the caller's own drafts without an id, summaries only", async () => {
    const me = await makeUser();
    const other = await makeUser();
    const k = await draftVia(me, "mine");
    await draftVia(other, "theirs");

    const res = await request("GET", "/api/v1/knowledge/mine", { token: me.token });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.total, 1);
    const [item] = res.json.data.items;
    assert.equal(item._id, k._id);
    assert.equal(item.status, "draft");
    assert.equal("body" in item, false);
  });

  it("supports ?status= and rejects an invalid status with 400", async () => {
    const me = await makeUser();
    await draftVia(me, "a");
    await pendingVia(me, "b");
    const ok = await request("GET", "/api/v1/knowledge/mine?status=pending_review", { token: me.token });
    assert.equal(ok.json.data.total, 1);
    const bad = await request("GET", "/api/v1/knowledge/mine?status=published", { token: me.token });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, "VALIDATION_FAILED");
  });

  it("rejects invalid pagination with 400", async () => {
    const me = await makeUser();
    for (const q of ["page=0", "limit=51", "limit=abc"]) {
      const res = await request("GET", `/api/v1/knowledge/mine?${q}`, { token: me.token });
      assert.equal(res.status, 400, q);
    }
  });

  it("ignores a caller-supplied author parameter", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await draftVia(other, "theirs");
    const res = await request("GET", `/api/v1/knowledge/mine?author=${other.id}`, { token: me.token });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.total, 0);
  });
});

describe("GET /api/v1/knowledge/review-queue", () => {
  it("EXPERT sees pending articles from others; 403 for USER and ADMIN", async () => {
    const expert = await makeUser("EXPERT");
    const admin = await makeUser("ADMIN");
    const author = await makeUser();
    const k = await pendingVia(author, "t");
    await draftVia(author, "still draft");

    const ok = await request("GET", "/api/v1/knowledge/review-queue", { token: expert.token });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.total, 1);
    assert.equal(ok.json.data.items[0]._id, k._id);

    for (const u of [author, admin]) {
      const res = await request("GET", "/api/v1/knowledge/review-queue", { token: u.token });
      assert.equal(res.status, 403);
      assert.equal(res.json.code, "FORBIDDEN");
    }
  });

  it("rejects invalid pagination with 400", async () => {
    const expert = await makeUser("EXPERT");
    const res = await request("GET", "/api/v1/knowledge/review-queue?limit=51", { token: expert.token });
    assert.equal(res.status, 400);
  });
});

describe("GET /api/v1/knowledge/:knowledgeId/workflow", () => {
  it("401 when anonymous", async () => {
    const author = await makeUser();
    const k = await draftVia(author);
    const res = await request("GET", `/api/v1/knowledge/${k._id}/workflow`);
    assert.equal(res.status, 401);
  });

  it("200 for the author (draft) with the full DTO", async () => {
    const author = await makeUser("USER", "Asha");
    const k = await draftVia(author, "t");
    const res = await request("GET", `/api/v1/knowledge/${k._id}/workflow`, { token: author.token });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.body, "Body of t");
    assert.deepEqual(res.json.data.author, { _id: author.id, name: "Asha", role: "USER" });
    assert.deepEqual(res.json.data.reviewHistory, []);
  });

  it("200 for an EXPERT on pending_review; uniform 404 for draft, other users, ADMIN", async () => {
    const author = await makeUser();
    const expert = await makeUser("EXPERT");
    const stranger = await makeUser();
    const admin = await makeUser("ADMIN");
    const pending = await pendingVia(author, "p");
    const draft = await draftVia(author, "d");

    const ok = await request("GET", `/api/v1/knowledge/${pending._id}/workflow`, { token: expert.token });
    assert.equal(ok.status, 200);

    for (const [viewer, k] of [[expert, draft], [stranger, pending], [admin, pending]]) {
      const res = await request("GET", `/api/v1/knowledge/${k._id}/workflow`, { token: viewer.token });
      assert.equal(res.status, 404);
      assert.equal(res.json.code, "NOT_FOUND");
    }
  });

  it("404 for a nonexistent id and 400 for a malformed id", async () => {
    const me = await makeUser();
    const missing = await request("GET", "/api/v1/knowledge/507f1f77bcf86cd799439011/workflow", { token: me.token });
    assert.equal(missing.status, 404);
    const bad = await request("GET", "/api/v1/knowledge/nope/workflow", { token: me.token });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, "VALIDATION_FAILED");
  });
});

describe("public Knowledge contract is unchanged", () => {
  it("non-approved articles stay invisible to the public list and detail", async () => {
    const author = await makeUser();
    const expert = await makeUser("EXPERT");
    const draft = await draftVia(author, "draft");
    const pending = await pendingVia(author, "pending");
    const rejected = await pendingVia(author, "rejected");
    await request("POST", `/api/v1/knowledge/${rejected._id}/reject`, { token: expert.token, body: { feedback: "no" } });

    const list = await request("GET", "/api/v1/knowledge");
    assert.equal(list.status, 200);
    assert.equal(list.json.data.total, 0);
    for (const k of [draft, pending, rejected]) {
      const res = await request("GET", `/api/v1/knowledge/${k._id}`);
      assert.equal(res.status, 404, k.title);
    }
  });

  it("an approved article keeps the existing public shape: body present, author populated, reviewer an unpopulated id", async () => {
    const author = await makeUser("USER", "Asha");
    const expert = await makeUser("EXPERT");
    const k = await pendingVia(author, "t");
    await request("POST", `/api/v1/knowledge/${k._id}/approve`, { token: expert.token });

    const detail = await request("GET", `/api/v1/knowledge/${k._id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.body, "Body of t");
    assert.deepEqual(detail.json.data.author, { _id: author.id, name: "Asha", role: "USER" });
    assert.equal(detail.json.data.reviewHistory[0].reviewer, expert.id);

    const list = await request("GET", "/api/v1/knowledge");
    assert.equal(list.json.data.items[0].body, "Body of t");
  });
});
