import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { issueRouter } from "../src/routes/issue.routes.js";
import { register } from "../src/services/auth.service.js";
import { Issue } from "../src/models/Issue.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * Issue #41 — HTTP behavior of public Issue discovery on
 * GET /api/v1/issues: query parsing, validation errors, anonymous access,
 * and the canonical success/error envelopes, against real MongoDB.
 * Contract: docs/architecture/issue-discovery-contract.md.
 */

let server;
let baseUrl;

before(async () => {
  await setupTestDb();
  await Issue.init();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/v1/issues", issueRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await teardownTestDb();
});

beforeEach(clearCollections);

function get(path, { token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Cookie: `${ACCESS_TOKEN_COOKIE_NAME}=${token}` } : {};
    const req = http.request(`${baseUrl}${path}`, { method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          // non-JSON
        }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const REPORTER = new mongoose.Types.ObjectId();
let n = 0;
async function seed(over = {}) {
  n += 1;
  return Issue.create({
    title: `Issue ${n}`,
    description: `Description ${n}`,
    location: { type: "Point", coordinates: [77.5, 12.5] },
    reportedBy: REPORTER,
    ...over,
  });
}
const at = (lng, lat) => ({ type: "Point", coordinates: [lng, lat] });
const titles = (body) => body.data.items.map((i) => i.title).sort();

async function expectValidationError(query, fieldHint) {
  const res = await get(`/api/v1/issues?${query}`);
  assert.equal(res.status, 400, query);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "VALIDATION_FAILED");
  assert.equal(typeof res.body.message, "string");
  assert.equal(res.body.data, null);
  assert.deepEqual(Object.keys(res.body).sort(), ["code", "data", "message", "success"]);
  if (fieldHint) assert.match(JSON.stringify(res.body), new RegExp(fieldHint), query);
}

describe("GET /api/v1/issues — discovery filters over HTTP", () => {
  it("is anonymous: no cookie, no session, 200", async () => {
    await seed({ title: "xx" });
    const res = await get("/api/v1/issues?q=xx&bbox=77,12,78,13");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.total, 1);
  });

  it("an authenticated caller gets the same result as an anonymous one (no per-role filtering)", async () => {
    await seed({ title: "xx" });
    const { accessToken } = await register({
      name: "T",
      email: `u-${Date.now()}@example.com`,
      password: "correcthorsebatterystaple",
    });
    const anon = await get("/api/v1/issues");
    const authed = await get("/api/v1/issues", { token: accessToken });
    assert.deepEqual(authed.body, anon.body);
  });

  it("unfiltered: canonical success envelope and unchanged page shape", async () => {
    const { user } = await register({
      name: "Asha",
      email: `r-${Date.now()}@example.com`,
      password: "correcthorsebatterystaple",
    });
    await seed({ title: "a", reportedBy: user.id });
    const res = await get("/api/v1/issues");
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.message, "string");
    assert.deepEqual(Object.keys(res.body).sort(), ["data", "message", "success"]);
    assert.deepEqual(Object.keys(res.body.data).sort(), ["items", "limit", "page", "total", "totalPages"]);
    // reportedBy is still populated with public-actor fields only.
    assert.deepEqual(Object.keys(res.body.data.items[0].reportedBy).sort(), ["_id", "name", "role"]);
  });

  it("filters by status, category and severity", async () => {
    await seed({ title: "a", status: "open", category: "water_quality", severity: "high" });
    await seed({ title: "b", status: "resolved", category: "water_quality", severity: "low" });
    assert.deepEqual(titles((await get("/api/v1/issues?status=resolved")).body), ["b"]);
    assert.deepEqual(titles((await get("/api/v1/issues?category=water_quality")).body), ["a", "b"]);
    assert.deepEqual(titles((await get("/api/v1/issues?severity=high")).body), ["a"]);
    assert.deepEqual(titles((await get("/api/v1/issues?status=open&category=water_quality&severity=high")).body), ["a"]);
  });

  it("searches text with q, URL-decoded", async () => {
    await seed({ title: "Burst pipe on Main Road" });
    await seed({ title: "Dry well" });
    assert.deepEqual(titles((await get("/api/v1/issues?q=main%20road")).body), ["Burst pipe on Main Road"]);
    assert.deepEqual(titles((await get("/api/v1/issues?q=main+road")).body), ["Burst pipe on Main Road"]);
    assert.deepEqual(titles((await get("/api/v1/issues?q=%20%20well%20%20")).body), ["Dry well"]);
  });

  it("a punctuation-only q is a valid request with an empty result (200, never 400/404)", async () => {
    await seed({ title: "Burst pipe -- urgent" });
    for (const q of ["--", "%3F!", "%25%25"]) {
      const res = await get(`/api/v1/issues?q=${q}`);
      assert.equal(res.status, 200, q);
      assert.deepEqual(res.body.data, { items: [], page: 1, limit: 20, total: 0, totalPages: 0 }, q);
    }
  });

  it("a punctuation-only term next to a searchable term is still required over HTTP", async () => {
    await seed({ title: "Burst pipe -- urgent" });
    await seed({ title: "Burst pipe" });
    assert.deepEqual(titles((await get("/api/v1/issues?q=burst%20--")).body), ["Burst pipe -- urgent"]);
    assert.deepEqual(titles((await get("/api/v1/issues?q=burst%20%23%23%23")).body), []);
  });

  it("q requires every term as a whole word over HTTP (not OR, not substring)", async () => {
    await seed({ title: "main only" });
    await seed({ title: "handpump only" });
    await seed({ title: "Handpump maintenance needed" });
    await seed({ title: "Handpump main road" });
    const res = await get("/api/v1/issues?q=main%20handpump");
    assert.equal(res.status, 200);
    assert.deepEqual(titles(res.body), ["Handpump main road"]);
    assert.equal(res.body.data.total, 1);
    assert.deepEqual(titles((await get("/api/v1/issues?q=%22main%20handpump%22")).body), ["Handpump main road"]);
  });

  it("filters by bbox given as west,south,east,north (longitude first), edges inclusive", async () => {
    await seed({ title: "in", location: at(77.5, 12.5) });
    await seed({ title: "edge", location: at(78, 13) });
    await seed({ title: "swapped-axes", location: at(12.5, 77.5) });
    await seed({ title: "out", location: at(78.0001, 12.5) });
    const res = await get("/api/v1/issues?bbox=77,12,78,13");
    assert.equal(res.status, 200);
    assert.deepEqual(titles(res.body), ["edge", "in"]);
    // Longitude-first is enforced by the data, not just the docs: a latitude-first client gets nothing.
    assert.deepEqual(titles((await get("/api/v1/issues?bbox=12,77,13,78")).body), ["swapped-axes"]);
  });

  it("accepts URL-encoded commas and spaces in bbox", async () => {
    await seed({ title: "in", location: at(77.5, 12.5) });
    assert.deepEqual(titles((await get("/api/v1/issues?bbox=77%2C12%2C78%2C13")).body), ["in"]);
    assert.deepEqual(titles((await get("/api/v1/issues?bbox=77,%2012,%2078,%2013")).body), ["in"]);
  });

  it("combines every filter with pagination", async () => {
    for (let i = 0; i < 5; i += 1) {
      await seed({
        title: `Pipe ${i}`, status: "open", category: "leakage_wastage", severity: "high",
        location: at(77.5, 12.5), createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
      });
    }
    await seed({ title: "Pipe elsewhere", status: "open", category: "leakage_wastage", severity: "high", location: at(10, 10) });
    const q = "q=pipe&status=open&category=leakage_wastage&severity=high&bbox=77,12,78,13";
    const p1 = await get(`/api/v1/issues?${q}&limit=2&page=1`);
    const p3 = await get(`/api/v1/issues?${q}&limit=2&page=3`);
    assert.deepEqual(p1.body.data.items.map((i) => i.title), ["Pipe 4", "Pipe 3"]);
    assert.deepEqual(p3.body.data.items.map((i) => i.title), ["Pipe 0"]);
    assert.equal(p1.body.data.total, 5);
    assert.equal(p1.body.data.totalPages, 3);
  });

  it("no match is a 200 with an empty page, never a 404", async () => {
    await seed({ title: "a" });
    const res = await get("/api/v1/issues?q=zzzzzz");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    const geo = await get("/api/v1/issues?bbox=0,0,1,1");
    assert.equal(geo.status, 200);
    assert.equal(geo.body.data.total, 0);
  });

  it("ignores unknown parameters, like every other list route", async () => {
    await seed({ title: "a" });
    const res = await get("/api/v1/issues?near=1,2&radius=5&sort=oldest");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.total, 1);
  });

  it("keeps newest-first, stable ordering across filters", async () => {
    const same = new Date("2026-02-02T00:00:00Z");
    for (let i = 0; i < 5; i += 1) await seed({ title: `s${i}`, createdAt: same, category: "other" });
    const seen = [];
    for (let page = 1; page <= 3; page += 1) {
      seen.push(...(await get(`/api/v1/issues?category=other&limit=2&page=${page}`)).body.data.items.map((i) => i._id));
    }
    assert.equal(new Set(seen).size, 5);
    assert.deepEqual(seen, [...seen].sort().reverse());
  });
});

describe("GET /api/v1/issues — invalid discovery parameters (400, canonical error envelope)", () => {
  const cases = [
    ["category=nope", "category"],
    ["category=", "category"],
    ["severity=catastrophic", "severity"],
    ["status=closed", "status"],
    ["status=open&status=resolved", "status"],
    ["q=a", "q"],
    ["q=", "q"],
    ["q=%20%20%20", "q"],
    ["q=%22%22", "q"],
    [`q=${"a".repeat(101)}`, "q"],
    [`q=${Array(11).fill("ab").join("%20")}`, "q"],
    ["q=ab&q=cd", "repeated"],
    ["bbox=", "bbox"],
    ["bbox=1,2,3", "bbox"],
    ["bbox=1,2,3,4,5", "bbox"],
    ["bbox=a,b,c,d", "bbox"],
    ["bbox=1,,3,4", "bbox"],
    ["bbox=77,12,78,NaN", "bbox"],
    ["bbox=78,12,77,13", "bbox"],
    ["bbox=77,13,78,12", "bbox"],
    ["bbox=77,12,77,13", "bbox"],
    ["bbox=-181,0,-175,1", "bbox"],
    ["bbox=175,0,181,1", "bbox"],
    ["bbox=0,80,1,86", "bbox"],
    ["bbox=0,0,10.01,1", "bbox"],
    ["bbox=0,0,1,10.01", "bbox"],
    ["bbox=-180,-85,180,85", "bbox"],
    ["bbox=77,12,78,13&bbox=1,1,2,2", "repeated"],
    ["page=0", "page"],
    ["limit=51", "limit"],
    ["limit=abc", "limit"],
  ];
  for (const [query, field] of cases) {
    it(`rejects ${query.length > 70 ? `${query.slice(0, 70)}…` : query}`, async () => {
      // Custom messages (q, bbox) name the parameter; Zod's stock enum/number
      // messages (status, category, severity, page, limit) do not, and the
      // shared envelope is not changed by this issue.
      await expectValidationError(query, field === "q" || field === "bbox" ? field : undefined);
    });
  }

  it("a bad parameter is rejected even when the others are valid (nothing is silently dropped)", async () => {
    await seed({ title: "a" });
    const res = await get("/api/v1/issues?status=open&bbox=0,0,50,50");
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "VALIDATION_FAILED");
  });

  it("accepts the exact documented boundaries", async () => {
    for (const q of [
      "bbox=0,0,10,10",
      "bbox=-180,-85,-170,-75",
      "bbox=170,75,180,85",
      `q=${"a".repeat(100)}`,
      "q=ab",
      `q=${Array(10).fill("ab").join("%20")}`,
      "limit=50",
      "limit=1",
    ]) {
      const res = await get(`/api/v1/issues?${q}`);
      assert.equal(res.status, 200, q);
    }
  });

  it("never reflects internals in an error (no stack, no database text)", async () => {
    const res = await get("/api/v1/issues?bbox=nope");
    const text = JSON.stringify(res.body);
    assert.doesNotMatch(text, /stack|mongo|ObjectId|at .*\.js/i);
  });
});
