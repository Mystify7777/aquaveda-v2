import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { commentRouter } from "../src/routes/comment.routes.js";
import { Discussion } from "../src/models/Discussion.js";
import { createDiscussion } from "../src/services/discussion.service.js";
import { register } from "../src/services/auth.service.js";
import {
  setupTestDb,
  teardownTestDb,
  clearCollections,
  fakeActor,
} from "./helpers/testDb.js";

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

async function makeAuthedUser() {
  return register({
    name: "Discussion Commenter",
    email:
      "commenter-" +
      Date.now() +
      "-" +
      Math.random() +
      "@example.com",
    password: VALID_PASSWORD,
  });
}

function authCookie(accessToken) {
  return { [ACCESS_TOKEN_COOKIE_NAME]: accessToken };
}

describe("POST /api/v1/comments with DISCUSSION target", () => {
  it("201s for an authenticated Discussion comment", async () => {
    const { accessToken } = await makeAuthedUser();
    const discussion = await createDiscussion(fakeActor("USER"), {
      title: "Water access",
      body: "Where can we find testing information?",
      category: "QUESTION",
    });

    const res = await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: {
        refType: "DISCUSSION",
        refId: String(discussion._id),
        body: "Here is useful information.",
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.data.refType, "DISCUSSION");
    assert.equal(res.json.data.refId, String(discussion._id));
  });

  it("400s for an unsupported refType while preserving the existing validation boundary", async () => {
    const { accessToken } = await makeAuthedUser();

    const res = await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: {
        refType: "NOT_A_REAL_TYPE",
        refId: "507f1f77bcf86cd799439011",
        body: "x",
      },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.code, "VALIDATION_FAILED");
  });
});

describe("GET /api/v1/comments with DISCUSSION target", () => {
  it("returns an ACTIVE Discussion thread anonymously", async () => {
    const { accessToken } = await makeAuthedUser();
    const discussion = await createDiscussion(fakeActor("USER"), {
      title: "Public discussion",
      body: "body",
      category: "DISCUSSION",
    });

    await request("POST", "/api/v1/comments", {
      cookies: authCookie(accessToken),
      body: {
        refType: "DISCUSSION",
        refId: String(discussion._id),
        body: "public comment",
      },
    });

    const res = await request(
      "GET",
      "/api/v1/comments?refType=DISCUSSION&refId=" +
        String(discussion._id),
    );

    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 1);
    assert.equal(res.json.data[0].body, "public comment");
  });

  it("404s for a hidden Discussion thread", async () => {
    const discussion = await createDiscussion(fakeActor("USER"), {
      title: "Hidden discussion",
      body: "secret",
      category: "IDEA",
    });
    await Discussion.updateOne(
      { _id: discussion._id },
      { $set: { status: "HIDDEN" } },
    );

    const res = await request(
      "GET",
      "/api/v1/comments?refType=DISCUSSION&refId=" +
        String(discussion._id),
    );

    assert.equal(res.status, 404);
    assert.equal(res.json.code, "TARGET_NOT_FOUND");
  });
});
