import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { discussionRouter } from "../src/routes/discussion.routes.js";
import { discussionReportRouter } from "../src/routes/discussion-report.routes.js";
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
  app.use("/api/v1/discussion-reports", discussionReportRouter);
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
    name: role + " Discussion User",
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

async function createDiscussion(accessToken) {
  const res = await request("POST", "/api/v1/discussions", {
    cookies: authCookie(accessToken),
    body: {
      title: "Groundwater testing",
      body: "Where can we get groundwater tested?",
      category: "QUESTION",
    },
  });
  assert.equal(res.status, 201);
  return res.json.data;
}

describe("POST /api/v1/discussions/:discussionId/reports", () => {
  it("requires authentication", async () => {
    const res = await request(
      "POST",
      "/api/v1/discussions/507f1f77bcf86cd799439011/reports",
      { body: { reason: "SPAM" } },
    );

    assert.equal(res.status, 401);
    assert.equal(res.json.code, "UNAUTHORIZED");
  });

  it("submits a report and prevents duplicate/self reports", async () => {
    const author = await makeAuthedUser();
    const reporter = await makeAuthedUser();
    const discussion = await createDiscussion(author.accessToken);

    const submitted = await request(
      "POST",
      "/api/v1/discussions/" + discussion._id + "/reports",
      {
        cookies: authCookie(reporter.accessToken),
        body: { reason: "MISLEADING" },
      },
    );

    assert.equal(submitted.status, 201);
    assert.equal(submitted.json.data.reason, "MISLEADING");

    const duplicate = await request(
      "POST",
      "/api/v1/discussions/" + discussion._id + "/reports",
      {
        cookies: authCookie(reporter.accessToken),
        body: { reason: "SPAM" },
      },
    );

    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.json.code, "INVALID_STATE");

    const selfReport = await request(
      "POST",
      "/api/v1/discussions/" + discussion._id + "/reports",
      {
        cookies: authCookie(author.accessToken),
        body: { reason: "SPAM" },
      },
    );

    assert.equal(selfReport.status, 403);
    assert.equal(selfReport.json.code, "FORBIDDEN");
  });
});

describe("Discussion visibility moderation routes", () => {
  it("allows author self-hide but not author unhide", async () => {
    const author = await makeAuthedUser();
    const discussion = await createDiscussion(author.accessToken);

    const hidden = await request(
      "POST",
      "/api/v1/discussions/" + discussion._id + "/hide",
      { cookies: authCookie(author.accessToken), body: {} },
    );
    assert.equal(hidden.status, 200);
    assert.equal(hidden.json.data.status, "HIDDEN");

    const publicRead = await request(
      "GET",
      "/api/v1/discussions/" + discussion._id,
    );
    assert.equal(publicRead.status, 404);
    assert.equal(publicRead.json.code, "NOT_FOUND");

    const unhide = await request(
      "POST",
      "/api/v1/discussions/" + discussion._id + "/unhide",
      {
        cookies: authCookie(author.accessToken),
        body: { reason: "I changed my mind" },
      },
    );
    assert.equal(unhide.status, 403);
    assert.equal(unhide.json.code, "FORBIDDEN");
  });

  it("allows ADMIN hide/unhide and rejects EXPERT moderation", async () => {
    const author = await makeAuthedUser();
    const expert = await makeAuthedUser("EXPERT");
    const admin = await makeAuthedUser("ADMIN");
    const discussion = await createDiscussion(author.accessToken);

    const expertHide = await request(
      "POST",
      "/api/v1/discussions/" + discussion._id + "/hide",
      {
        cookies: authCookie(expert.accessToken),
        body: { reason: "expert action" },
      },
    );
    assert.equal(expertHide.status, 403);
    assert.equal(expertHide.json.code, "FORBIDDEN");

    const adminWithoutReason = await request(
      "POST",
      "/api/v1/discussions/" + discussion._id + "/hide",
      { cookies: authCookie(admin.accessToken), body: {} },
    );
    assert.equal(adminWithoutReason.status, 400);
    assert.equal(adminWithoutReason.json.code, "VALIDATION_FAILED");

    const hidden = await request(
      "POST",
      "/api/v1/discussions/" + discussion._id + "/hide",
      {
        cookies: authCookie(admin.accessToken),
        body: { reason: "Policy violation" },
      },
    );
    assert.equal(hidden.status, 200);
    assert.equal(hidden.json.data.status, "HIDDEN");

    const restored = await request(
      "POST",
      "/api/v1/discussions/" + discussion._id + "/unhide",
      {
        cookies: authCookie(admin.accessToken),
        body: { reason: "Review completed" },
      },
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.json.data.status, "ACTIVE");
  });
});

describe("GET /api/v1/discussion-reports", () => {
  it("is ADMIN-only", async () => {
    const author = await makeAuthedUser();
    const reporter = await makeAuthedUser();
    const admin = await makeAuthedUser("ADMIN");
    const discussion = await createDiscussion(author.accessToken);

    await request(
      "POST",
      "/api/v1/discussions/" + discussion._id + "/reports",
      {
        cookies: authCookie(reporter.accessToken),
        body: { reason: "SPAM" },
      },
    );

    const userRead = await request(
      "GET",
      "/api/v1/discussion-reports",
      { cookies: authCookie(reporter.accessToken) },
    );
    assert.equal(userRead.status, 403);
    assert.equal(userRead.json.code, "FORBIDDEN");

    const adminRead = await request(
      "GET",
      "/api/v1/discussion-reports",
      { cookies: authCookie(admin.accessToken) },
    );
    assert.equal(adminRead.status, 200);
    assert.equal(adminRead.json.data.total, 1);
    assert.equal(adminRead.json.data.items[0].reason, "SPAM");
    assert.equal(
      adminRead.json.data.items[0].discussion._id,
      discussion._id,
    );
  });
});
