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
 * Focused HTTP tests for knowledge.routes.js.
 *
 * Same local-test-app pattern as issue.routes.test.js — knowledgeRouter
 * is not yet mounted into src/app.js's createApp() (Phase 7).
 */

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/v1/knowledge", knowledgeRouter);
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

async function makeAuthedUser(role = "USER") {
  const { user, accessToken } = await register({
    name: "Test User",
    email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@example.com`,
    password: VALID_PASSWORD,
  });
  if (role !== "USER") {
    await User.updateOne({ _id: user.id }, { $set: { role } });
  }
  return { user, accessToken };
}

function authCookie(accessToken) {
  return { [ACCESS_TOKEN_COOKIE_NAME]: accessToken };
}

async function makeDraft(accessToken) {
  const res = await request("POST", "/api/v1/knowledge", {
    cookies: authCookie(accessToken),
    body: { title: "Drip irrigation basics", body: "How to set up drip irrigation." },
  });
  return res.json.data;
}

describe("POST /api/v1/knowledge", () => {
  it("201s and returns the created draft in the complete canonical envelope (ROUTE-L6)", async () => {
    const { accessToken } = await makeAuthedUser("USER");
    const res = await request("POST", "/api/v1/knowledge", {
      cookies: authCookie(accessToken),
      body: { title: "Drip irrigation basics", body: "How to set up drip irrigation." },
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.success, true);
    assert.equal(typeof res.json.message, "string");
    assert.ok(res.json.message.length > 0);
    assert.equal(res.json.data.status, "draft");
    assert.equal(Object.keys(res.json).sort().join(","), "data,message,success");
  });

  it("400s with VALIDATION_FAILED for a missing body field", async () => {
    const { accessToken } = await makeAuthedUser("USER");
    const res = await request("POST", "/api/v1/knowledge", {
      cookies: authCookie(accessToken),
      body: { title: "Drip irrigation basics" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("401s for an anonymous request", async () => {
    const res = await request("POST", "/api/v1/knowledge", {
      body: { title: "x", body: "y" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("404s with NOT_FOUND for a well-formed but nonexistent knowledgeId (on a mutation route, not create)", async () => {
    const { accessToken } = await makeAuthedUser("USER");
    const res = await request("POST", "/api/v1/knowledge/507f1f77bcf86cd799439011/submit", {
      cookies: authCookie(accessToken),
    });
    assert.equal(res.status, 404);
    assert.equal(res.json.code, "NOT_FOUND");
  });

  it("400s with VALIDATION_FAILED (CastError translation) for a malformed knowledgeId", async () => {
    const { accessToken } = await makeAuthedUser("USER");
    const res = await request("POST", "/api/v1/knowledge/not-a-valid-object-id/submit", {
      cookies: authCookie(accessToken),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });
});

describe("POST /api/v1/knowledge/:knowledgeId/submit", () => {
  it("200s and moves status to pending_review", async () => {
    const author = await makeAuthedUser("USER");
    const draft = await makeDraft(author.accessToken);

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {
      cookies: authCookie(author.accessToken),
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "pending_review");
  });

  it("403s with FORBIDDEN when a non-author attempts to submit", async () => {
    const author = await makeAuthedUser("USER");
    const other = await makeAuthedUser("USER");
    const draft = await makeDraft(author.accessToken);

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {
      cookies: authCookie(other.accessToken),
    });

    assert.equal(res.status, 403);
    assert.equal(res.json.code, "FORBIDDEN");
  });

  it("401s for an anonymous submit attempt (mutation beyond create)", async () => {
    const author = await makeAuthedUser("USER");
    const draft = await makeDraft(author.accessToken);

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {});

    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });
});

describe("POST /api/v1/knowledge/:knowledgeId/approve", () => {
  it("200s for an EXPERT approving another author's submission", async () => {
    const author = await makeAuthedUser("USER");
    const expert = await makeAuthedUser("EXPERT");
    const draft = await makeDraft(author.accessToken);
    await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {
      cookies: authCookie(author.accessToken),
    });

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/approve`, {
      cookies: authCookie(expert.accessToken),
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "approved");
  });

  it("403s with FORBIDDEN for a non-EXPERT", async () => {
    const author = await makeAuthedUser("USER");
    const other = await makeAuthedUser("USER");
    const draft = await makeDraft(author.accessToken);
    await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {
      cookies: authCookie(author.accessToken),
    });

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/approve`, {
      cookies: authCookie(other.accessToken),
    });

    assert.equal(res.status, 403);
    assert.equal(res.json.code, "FORBIDDEN");
  });

  it("403s with FORBIDDEN when the author attempts to approve their own submission", async () => {
    const author = await makeAuthedUser("EXPERT");
    const draft = await makeDraft(author.accessToken);
    await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {
      cookies: authCookie(author.accessToken),
    });

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/approve`, {
      cookies: authCookie(author.accessToken),
    });

    assert.equal(res.status, 403);
    assert.equal(res.json.code, "FORBIDDEN");
  });
});

describe("POST /api/v1/knowledge/:knowledgeId/reject", () => {
  it("200s with valid feedback and moves status to rejected", async () => {
    const author = await makeAuthedUser("USER");
    const expert = await makeAuthedUser("EXPERT");
    const draft = await makeDraft(author.accessToken);
    await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {
      cookies: authCookie(author.accessToken),
    });

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/reject`, {
      cookies: authCookie(expert.accessToken),
      body: { feedback: "needs more sourcing" },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "rejected");
  });

  it("400s with VALIDATION_FAILED for empty feedback", async () => {
    const author = await makeAuthedUser("USER");
    const expert = await makeAuthedUser("EXPERT");
    const draft = await makeDraft(author.accessToken);
    await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {
      cookies: authCookie(author.accessToken),
    });

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/reject`, {
      cookies: authCookie(expert.accessToken),
      body: { feedback: "" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("403s with FORBIDDEN for a non-EXPERT attempting to reject", async () => {
    const author = await makeAuthedUser("USER");
    const other = await makeAuthedUser("USER");
    const draft = await makeDraft(author.accessToken);
    await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {
      cookies: authCookie(author.accessToken),
    });

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/reject`, {
      cookies: authCookie(other.accessToken),
      body: { feedback: "needs more sourcing" },
    });

    assert.equal(res.status, 403);
    assert.equal(res.json.code, "FORBIDDEN");
  });
});

describe("POST /api/v1/knowledge/:knowledgeId/revise", () => {
  it("200s and applies a partial update after rejection", async () => {
    const author = await makeAuthedUser("USER");
    const expert = await makeAuthedUser("EXPERT");
    const draft = await makeDraft(author.accessToken);
    await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {
      cookies: authCookie(author.accessToken),
    });
    await request("POST", `/api/v1/knowledge/${draft._id}/reject`, {
      cookies: authCookie(expert.accessToken),
      body: { feedback: "needs work" },
    });

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/revise`, {
      cookies: authCookie(author.accessToken),
      body: { title: "Drip irrigation basics, revised" },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.data.title, "Drip irrigation basics, revised");
    assert.equal(res.json.data.status, "draft");
  });

  it("409s with INVALID_STATE when the Knowledge is not in rejected status", async () => {
    const author = await makeAuthedUser("USER");
    const draft = await makeDraft(author.accessToken);

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/revise`, {
      cookies: authCookie(author.accessToken),
      body: { title: "won't work, still a draft" },
    });

    assert.equal(res.status, 409);
    assert.equal(res.json.code, "INVALID_STATE");
  });

  it("403s with FORBIDDEN when a non-author attempts to revise", async () => {
    const author = await makeAuthedUser("USER");
    const other = await makeAuthedUser("USER");
    const expert = await makeAuthedUser("EXPERT");
    const draft = await makeDraft(author.accessToken);
    await request("POST", `/api/v1/knowledge/${draft._id}/submit`, {
      cookies: authCookie(author.accessToken),
    });
    await request("POST", `/api/v1/knowledge/${draft._id}/reject`, {
      cookies: authCookie(expert.accessToken),
      body: { feedback: "needs work" },
    });

    const res = await request("POST", `/api/v1/knowledge/${draft._id}/revise`, {
      cookies: authCookie(other.accessToken),
      body: { title: "attempted by a non-author" },
    });

    assert.equal(res.status, 403);
    assert.equal(res.json.code, "FORBIDDEN");
  });
});
