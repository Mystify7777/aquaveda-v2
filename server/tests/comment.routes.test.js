import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { commentRouter } from "../src/routes/comment.routes.js";
import { createIssue } from "../src/services/issue.service.js";
import { createKnowledge, submitForReview, approve, reject } from "../src/services/knowledge.service.js";
import { register } from "../src/services/auth.service.js";
import { setupTestDb, teardownTestDb, clearCollections, fakeActor, validPoint } from "./helpers/testDb.js";

/**
 * Focused HTTP tests for comment.routes.js.
 *
 * Same local-test-app pattern as issue/knowledge.routes.test.js.
 * Issue/Knowledge fixtures are created directly via the service layer
 * (not HTTP — only commentRouter is mounted in this test app), matching
 * comment.service.test.js's own fixture pattern.
 */

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/v1/comments", commentRouter);
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

async function makeIssue() {
  return createIssue(fakeActor("USER"), {
    title: "Leaking pipe",
    description: "d",
    location: validPoint(),
  });
}

async function makeKnowledge() {
  return createKnowledge(fakeActor("USER"), { title: "t", body: "b" });
}

describe("POST /api/v1/comments", () => {
  it("201s for a top-level comment on an Issue, with the complete canonical envelope (ROUTE-L6)", async () => {
    const { accessToken } = await makeAuthedUser();
    const issue = await makeIssue();

    const res = await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "ISSUE", refId: String(issue._id), body: "Affecting my street too." },
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.success, true);
    assert.equal(typeof res.json.message, "string");
    assert.ok(res.json.message.length > 0);
    assert.equal(res.json.data.refType, "ISSUE");
    assert.equal(Object.keys(res.json).sort().join(","), "data,message,success");
  });

  it("201s for a top-level comment on a Knowledge article (WIKI)", async () => {
    const { accessToken } = await makeAuthedUser();
    const knowledge = await makeKnowledge();

    const res = await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "WIKI", refId: String(knowledge._id), body: "Great article." },
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.data.refType, "WIKI");
  });

  it("400s with VALIDATION_FAILED for an unrecognized refType", async () => {
    const { accessToken } = await makeAuthedUser();
    const issue = await makeIssue();

    const res = await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "NOT_A_REAL_TYPE", refId: String(issue._id), body: "x" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("400s with VALIDATION_FAILED for a malformed refId (rejected by Zod's objectIdString before the service is ever called)", async () => {
    const { accessToken } = await makeAuthedUser();

    const res = await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "ISSUE", refId: "not-a-valid-object-id", body: "x" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
    assert.equal(res.json.data, null);
  });

  it("401s for an anonymous request", async () => {
    const issue = await makeIssue();
    const res = await request("POST", "/api/v1/comments", {
      body: { refType: "ISSUE", refId: String(issue._id), body: "x" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("404s with TARGET_NOT_FOUND for a well-formed but nonexistent refId", async () => {
    const { accessToken } = await makeAuthedUser();
    const res = await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "ISSUE", refId: "507f1f77bcf86cd799439011", body: "x" },
    });

    assert.equal(res.status, 404);
    assert.equal(res.json.code, "TARGET_NOT_FOUND");
  });

  it("409s with INVALID_PARENT for a reply targeting a different (refType, refId) than its parent", async () => {
    const { accessToken } = await makeAuthedUser();
    const issueA = await makeIssue();
    const issueB = await makeIssue();

    const parentRes = await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "ISSUE", refId: String(issueA._id), body: "parent" },
    });

    const res = await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: {
        refType: "ISSUE",
        refId: String(issueB._id),
        body: "cross-target reply",
        parentComment: parentRes.json.data._id,
      },
    });

    assert.equal(res.status, 409);
    assert.equal(res.json.code, "INVALID_PARENT");
  });
});

describe("GET /api/v1/comments (Issue #48 — public read, no auth required)", () => {
  it("200s for an anonymous request and returns an empty thread for a real target with no comments", async () => {
    const issue = await makeIssue();
    const res = await request("GET", `/api/v1/comments?refType=ISSUE&refId=${issue._id}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.deepEqual(res.json.data, []);
  });

  it("returns a top-level comment with its reply nested under it, without requiring any cookie", async () => {
    const { accessToken } = await makeAuthedUser();
    const issue = await makeIssue();
    const parentRes = await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "ISSUE", refId: String(issue._id), body: "parent" },
    });
    await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: {
        refType: "ISSUE",
        refId: String(issue._id),
        body: "a reply",
        parentComment: parentRes.json.data._id,
      },
    });

    const res = await request("GET", `/api/v1/comments?refType=ISSUE&refId=${issue._id}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 1);
    assert.equal(res.json.data[0].replies.length, 1);
    assert.equal(res.json.data[0].replies[0].body, "a reply");
  });

  it("400s with VALIDATION_FAILED for an unrecognized ?refType=", async () => {
    const issue = await makeIssue();
    const res = await request("GET", `/api/v1/comments?refType=NOT_A_REAL_TYPE&refId=${issue._id}`);
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("400s with VALIDATION_FAILED for a malformed ?refId=", async () => {
    const res = await request("GET", "/api/v1/comments?refType=ISSUE&refId=not-a-valid-object-id");
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("400s with VALIDATION_FAILED when refType or refId is missing entirely", async () => {
    const issue = await makeIssue();
    const missingRefType = await request("GET", `/api/v1/comments?refId=${issue._id}`);
    assert.equal(missingRefType.status, 400);

    const missingRefId = await request("GET", "/api/v1/comments?refType=ISSUE");
    assert.equal(missingRefId.status, 400);
  });

  it("404s with TARGET_NOT_FOUND for a well-formed but nonexistent refId", async () => {
    const res = await request("GET", "/api/v1/comments?refType=ISSUE&refId=507f1f77bcf86cd799439011");
    assert.equal(res.status, 404);
    assert.equal(res.json.code, "TARGET_NOT_FOUND");
  });

  it("does not mix comments from a different (refType, refId) target", async () => {
    const { accessToken } = await makeAuthedUser();
    const issue = await makeIssue();
    const knowledge = await makeKnowledge();
    await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "ISSUE", refId: String(issue._id), body: "on the issue" },
    });
    await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "WIKI", refId: String(knowledge._id), body: "on the knowledge article" },
    });

    const res = await request("GET", `/api/v1/comments?refType=ISSUE&refId=${issue._id}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 1);
    assert.equal(res.json.data[0].body, "on the issue");
  });

  it("REGRESSION (Issue #48 review): a WIKI thread on a draft Knowledge article is not publicly readable via HTTP", async () => {
    const { accessToken } = await makeAuthedUser();
    const draft = await makeKnowledge();
    await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "WIKI", refId: String(draft._id), body: "commenting on a draft" },
    });

    const res = await request("GET", `/api/v1/comments?refType=WIKI&refId=${draft._id}`);
    assert.equal(res.status, 404);
    assert.equal(res.json.code, "TARGET_NOT_FOUND");
  });

  it("REGRESSION (Issue #48 review): a WIKI thread on an approved Knowledge article IS publicly readable via HTTP", async () => {
    const { accessToken } = await makeAuthedUser();
    const author = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    const approved = await createKnowledge(author, { title: "t", body: "b" });
    await submitForReview(author, approved._id);
    await approve(expert, approved._id);
    await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: { refType: "WIKI", refId: String(approved._id), body: "commenting on an approved article" },
    });

    const res = await request("GET", `/api/v1/comments?refType=WIKI&refId=${approved._id}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 1);
    assert.equal(res.json.data[0].body, "commenting on an approved article");
  });
});
