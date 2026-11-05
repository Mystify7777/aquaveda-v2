import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";
import { defaultStore } from "../src/middleware/rate-limiter.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import { makeHttpUser } from "./helpers/issueHttp.js";
import { keysDeep, seedIssue, seedKnowledge, seedProject } from "./helpers/dashboardSeed.js";

/**
 * GET /api/v1/dashboard over real HTTP through the production middleware stack
 * (createApp) against the real test MongoDB (#53).
 */

const ORIGIN = "http://allowed.example.com";
const saved = {};
let server;
let base;

before(async () => {
  saved.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = ORIGIN;
  await setupTestDb();
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardownTestDb();
  if (saved.ALLOWED_ORIGINS === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = saved.ALLOWED_ORIGINS;
});
beforeEach(async () => {
  await clearCollections();
  defaultStore.reset();
});

function call(method, path, token) {
  return new Promise((resolve, reject) => {
    const headers = { Origin: ORIGIN };
    if (token) headers.Cookie = `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
    const req = http.request(`${base}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("GET /api/v1/dashboard: authentication", () => {
  it("anonymous caller: 401 with the shared failure envelope and no data", async () => {
    const res = await call("GET", "/api/v1/dashboard");
    assert.equal(res.status, 401);
    assert.deepEqual(Object.keys(res.json).sort(), ["code", "data", "message", "success"]);
    assert.equal(res.json.success, false);
    assert.equal(res.json.data, null);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("an invalid or tampered access token is treated as anonymous (401)", async () => {
    const user = await makeHttpUser("USER");
    for (const token of ["garbage", `${user.token}x`]) {
      assert.equal((await call("GET", "/api/v1/dashboard", token)).status, 401);
    }
  });

  it("authenticated caller of any role: 200 with the shared success envelope", async () => {
    for (const role of ["USER", "EXPERT", "ADMIN"]) {
      const u = await makeHttpUser(role);
      const res = await call("GET", "/api/v1/dashboard", u.token);
      assert.equal(res.status, 200, role);
      assert.deepEqual(Object.keys(res.json).sort(), ["data", "message", "success"]);
      assert.equal(res.json.success, true);
      assert.deepEqual(Object.keys(res.json.data), ["platform", "mine"]);
    }
  });
});

describe("GET /api/v1/dashboard: contract", () => {
  it("per-user response is never cacheable by a shared cache", async () => {
    const u = await makeHttpUser("USER");
    const res = await call("GET", "/api/v1/dashboard", u.token);
    assert.equal(res.headers["cache-control"], "private, no-store");
  });

  it("empty database: every documented field present and zero", async () => {
    const u = await makeHttpUser("USER");
    const { data } = (await call("GET", "/api/v1/dashboard", u.token)).json;
    assert.deepEqual(data, {
      platform: {
        issues: { total: 0, byStatus: { open: 0, acknowledged: 0, in_progress: 0, resolved: 0, verified: 0 } },
        knowledge: { approved: 0 },
        projects: { total: 0 },
      },
      mine: {
        issuesReported: { total: 0, byStatus: { open: 0, acknowledged: 0, in_progress: 0, resolved: 0, verified: 0 } },
        knowledge: { total: 0, byStatus: { draft: 0, pending_review: 0, approved: 0, rejected: 0 } },
        projects: { created: 0, contributing: 0 },
      },
    });
  });

  it("populated: exact numbers per caller, and no persistence fields or other users' data in the body", async () => {
    const a = await makeHttpUser("USER", "alice");
    const b = await makeHttpUser("USER", "bob");
    const i1 = await seedIssue(a, "open");
    await seedIssue(a, "verified");
    await seedIssue(b, "in_progress");
    await seedKnowledge(a, "approved");
    await seedKnowledge(a, "draft");
    await seedKnowledge(b, "pending_review");
    await seedProject({ creator: a, contributors: [b], originIssue: i1._id });

    const ra = await call("GET", "/api/v1/dashboard", a.token);
    const rb = await call("GET", "/api/v1/dashboard", b.token);

    assert.deepEqual(ra.json.data.platform, rb.json.data.platform);
    assert.deepEqual(ra.json.data.platform, {
      issues: { total: 3, byStatus: { open: 1, acknowledged: 0, in_progress: 1, resolved: 0, verified: 1 } },
      knowledge: { approved: 1 },
      projects: { total: 1 },
    });
    assert.equal(ra.json.data.mine.issuesReported.total, 2);
    assert.equal(rb.json.data.mine.issuesReported.total, 1);
    assert.deepEqual(ra.json.data.mine.projects, { created: 1, contributing: 0 });
    assert.deepEqual(rb.json.data.mine.projects, { created: 0, contributing: 1 });
    assert.deepEqual(rb.json.data.mine.knowledge.byStatus, { draft: 0, pending_review: 1, approved: 0, rejected: 0 });

    for (const res of [ra, rb]) {
      const keys = keysDeep(res.json);
      for (const forbidden of ["_id", "id", "__v", "createdAt", "updatedAt"]) assert.ok(!keys.has(forbidden), forbidden);
      for (const user of [a, b]) assert.ok(!res.text.includes(user.id), "no user id in the response");
      assert.ok(!res.text.includes("alice") && !res.text.includes("bob"));
    }
  });

  it("the caller is always the token's actor: query/body parameters cannot select another user's `mine`", async () => {
    const a = await makeHttpUser("USER");
    const b = await makeHttpUser("USER");
    await seedIssue(b, "open");
    await seedIssue(b, "open");

    const res = await call("GET", `/api/v1/dashboard?userId=${b.id}&reportedBy=${b.id}&actor=${b.id}`, a.token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.mine.issuesReported.total, 0);
    assert.equal(res.json.data.platform.issues.total, 2);
  });

  it("only GET exists: write methods are not routed", async () => {
    const u = await makeHttpUser("USER");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await call(method, "/api/v1/dashboard", u.token);
      assert.equal(res.status, 404, method);
    }
  });
});
