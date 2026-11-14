import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { discussionRouter } from "../src/routes/discussion.routes.js";
import { Discussion } from "../src/models/Discussion.js";
import { User } from "../src/models/User.js";
import { register } from "../src/services/auth.service.js";
import {
  setupTestDb,
  teardownTestDb,
  clearCollections,
} from "./helpers/testDb.js";

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/v1/discussions", discussionRouter);
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
  baseUrl = "http://127.0.0.1:" + port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardownTestDb();
});

beforeEach(async () => {
  await clearCollections();
  await Discussion.deleteMany({});
});

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
        .map(([k, v]) => k + "=" + v)
        .join("; ");
    }

    const req = http.request(baseUrl + path, { method, headers }, (res) => {
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
    name: "Discussion User",
    email:
      role.toLowerCase() +
      "-" +
      Date.now() +
      "-" +
      Math.random() +
      "@example.com",
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

describe("GET /api/v1/discussions", () => {
  it("200s anonymously with an empty page", async () => {
    const res = await request("GET", "/api/v1/discussions");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data.items, []);
    assert.equal(res.json.data.total, 0);
    assert.equal(res.json.data.totalPages, 0);
  });

  it("returns only ACTIVE Discussions and exposes the explicit public DTO", async () => {
    const { accessToken, user } = await makeAuthedUser();

    const created = await request("POST", "/api/v1/discussions", {
      cookies: authCookie(accessToken),
      body: {
        title: "Public discussion",
        body: "Public body",
        category: "QUESTION",
      },
    });
    assert.equal(created.status, 201);

    await Discussion.create({
      title: "Hidden discussion",
      body: "secret body",
      category: "IDEA",
      status: "HIDDEN",
      author: user.id,
    });

    const res = await request("GET", "/api/v1/discussions");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.items.length, 1);

    const item = res.json.data.items[0];
    assert.equal(item.title, "Public discussion");
    assert.equal(item.category, "QUESTION");
    assert.equal(item.status, "ACTIVE");
    assert.equal(item.author.name, "Discussion User");
    assert.equal(item.author.role, "USER");
    assert.equal(item.author.email, undefined);
    assert.equal(item.author.passwordHash, undefined);
    assert.equal(item.body, "Public body");
    assert.equal(
      Object.keys(item).sort().join(","),
      "_id,author,body,category,createdAt,status,title,updatedAt",
    );
  });

  it("400s for a limit above the shared maximum", async () => {
    const res = await request("GET", "/api/v1/discussions?limit=999");
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });

  it("400s for an invalid page", async () => {
    const res = await request("GET", "/api/v1/discussions?page=0");
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });
});

describe("GET /api/v1/discussions/:discussionId", () => {
  it("returns an ACTIVE Discussion anonymously", async () => {
    const { accessToken } = await makeAuthedUser();

    const created = await request("POST", "/api/v1/discussions", {
      cookies: authCookie(accessToken),
      body: {
        title: "Water access ideas",
        body: "Let's compare approaches.",
        category: "IDEA",
      },
    });

    const res = await request(
      "GET",
      "/api/v1/discussions/" + created.json.data._id,
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.title, "Water access ideas");
    assert.equal(res.json.data.status, "ACTIVE");
  });

  it("404s for a hidden Discussion, indistinguishably from a nonexistent public resource", async () => {
    const { user } = await makeAuthedUser();

    const hidden = await Discussion.create({
      title: "Hidden",
      body: "secret",
      category: "DISCUSSION",
      status: "HIDDEN",
      author: user.id,
    });

    const hiddenRes = await request(
      "GET",
      "/api/v1/discussions/" + hidden._id,
    );
    const missingRes = await request(
      "GET",
      "/api/v1/discussions/507f1f77bcf86cd799439011",
    );

    assert.equal(hiddenRes.status, 404);
    assert.equal(hiddenRes.json.code, "NOT_FOUND");
    assert.equal(missingRes.status, 404);
    assert.equal(missingRes.json.code, "NOT_FOUND");
  });

  it("400s for a malformed id", async () => {
    const res = await request(
      "GET",
      "/api/v1/discussions/not-a-valid-object-id",
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });
});

describe("POST /api/v1/discussions", () => {
  it("201s for an authenticated USER and server-owns author/status", async () => {
    const { accessToken, user } = await makeAuthedUser();

    const res = await request("POST", "/api/v1/discussions", {
      cookies: authCookie(accessToken),
      body: {
        title: "Question",
        body: "Where can we test groundwater?",
        category: "QUESTION",
        status: "HIDDEN",
        author: "507f1f77bcf86cd799439011",
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.status, "ACTIVE");
    assert.equal(res.json.data.author._id, user.id);
    assert.equal(
      Object.keys(res.json.data).sort().join(","),
      "_id,author,body,category,createdAt,status,title,updatedAt",
    );
  });

  it("401s for anonymous creation", async () => {
    const res = await request("POST", "/api/v1/discussions", {
      body: {
        title: "Anonymous",
        body: "should fail",
        category: "QUESTION",
      },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("400s for invalid request shape", async () => {
    const { accessToken } = await makeAuthedUser();

    const res = await request("POST", "/api/v1/discussions", {
      cookies: authCookie(accessToken),
      body: { title: "x", body: "y", category: "INVALID" },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });
});
