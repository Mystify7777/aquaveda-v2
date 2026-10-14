import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { expertApplicationRouter } from "../src/routes/expert-application.routes.js";
import { User } from "../src/models/User.js";
import { register } from "../src/services/auth.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/** #91 — HTTP contract for the Expert-application lifecycle. */

let server;
let baseUrl;

before(async () => {
  await setupTestDb();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/v1/expert-application", expertApplicationRouter);
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
    const req = http.request(`${baseUrl}/api/v1/expert-application${path}`, { method, headers }, (res) => {
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
async function makeUser(role = "USER") {
  seq += 1;
  const { user, accessToken } = await register({
    name: `Person ${seq}`,
    email: `${role.toLowerCase()}-${seq}-${Date.now()}-${Math.random()}@example.com`,
    password: "correcthorsebatterystaple",
  });
  // Fixture only: ADMIN provisioning is #89. The middleware reads role
  // fresh from the DB (L11), so the token needs no re-issue.
  if (role !== "USER") await User.updateOne({ _id: user.id }, { $set: { role } });
  return { id: String(user.id), token: accessToken };
}

describe("anonymous access", () => {
  it("every route is 401 UNAUTHORIZED", async () => {
    const id = "507f1f77bcf86cd799439011";
    for (const [m, p] of [
      ["POST", ""],
      ["GET", "/me"],
      ["GET", ""],
      ["POST", `/${id}/approve`],
      ["POST", `/${id}/reject`],
    ]) {
      const res = await request(m, p);
      assert.equal(res.status, 401, `${m} ${p}`);
      assert.equal(res.json.code, "UNAUTHORIZED");
    }
  });
});

describe("apply + status", () => {
  it("USER applies (201) and reads own status", async () => {
    const u = await makeUser();
    const none = await request("GET", "/me", { token: u.token });
    assert.equal(none.json.data.status, "none");

    const res = await request("POST", "", { token: u.token });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.status, "pending");

    const me = await request("GET", "/me", { token: u.token });
    assert.equal(me.json.data.status, "pending");
    assert.equal(me.json.data.history[0].fromStatus, null);
  });

  it("duplicate apply is 409 INVALID_STATE", async () => {
    const u = await makeUser();
    await request("POST", "", { token: u.token });
    const res = await request("POST", "", { token: u.token });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "INVALID_STATE");
  });

  it("client cannot self-assign EXPERT via the body: 400, and nothing changes", async () => {
    const u = await makeUser();
    for (const body of [{ role: "EXPERT" }, { status: "approved" }, { expertApplication: { status: "approved" } }]) {
      const res = await request("POST", "", { token: u.token, body });
      assert.equal(res.status, 400);
    }
    const doc = await User.findById(u.id).lean();
    assert.equal(doc.role, "USER");
    assert.equal(doc.expertApplication, undefined);
  });

  it("EXPERT applying is 403", async () => {
    const e = await makeUser("EXPERT");
    const res = await request("POST", "", { token: e.token });
    assert.equal(res.status, 403);
  });
});

describe("review", () => {
  it("queue is ADMIN-only (USER and EXPERT get 403)", async () => {
    for (const role of ["USER", "EXPERT"]) {
      const u = await makeUser(role);
      assert.equal((await request("GET", "", { token: u.token })).status, 403);
    }
    const admin = await makeUser("ADMIN");
    const res = await request("GET", "", { token: admin.token });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.total, 0);
  });

  it("ADMIN approves: 200, EXPERT granted, applicant sees approved", async () => {
    const admin = await makeUser("ADMIN");
    const u = await makeUser();
    await request("POST", "", { token: u.token });

    const q = await request("GET", "", { token: admin.token });
    assert.deepEqual(q.json.data.items.map((i) => i.userId), [u.id]);

    const res = await request("POST", `/${u.id}/approve`, { token: admin.token });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "approved");
    assert.equal((await User.findById(u.id).lean()).role, "EXPERT");
    assert.equal((await request("GET", "/me", { token: u.token })).json.data.status, "approved");

    const again = await request("POST", `/${u.id}/approve`, { token: admin.token });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, "INVALID_STATE");
  });

  it("ADMIN rejects with note: no EXPERT; applicant sees the note and may re-apply", async () => {
    const admin = await makeUser("ADMIN");
    const u = await makeUser();
    await request("POST", "", { token: u.token });
    const res = await request("POST", `/${u.id}/reject`, { token: admin.token, body: { note: "add detail" } });
    assert.equal(res.status, 200);
    assert.equal((await User.findById(u.id).lean()).role, "USER");

    const me = await request("GET", "/me", { token: u.token });
    assert.equal(me.json.data.status, "rejected");
    assert.equal(me.json.data.history.at(-1).note, "add detail");

    assert.equal((await request("POST", "", { token: u.token })).status, 201);
  });

  it("non-ADMIN cannot approve/reject (403) — including the applicant themself", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const expert = await makeUser("EXPERT");
    await request("POST", "", { token: u.token });
    for (const actor of [u, other, expert]) {
      assert.equal((await request("POST", `/${u.id}/approve`, { token: actor.token })).status, 403);
      assert.equal((await request("POST", `/${u.id}/reject`, { token: actor.token })).status, 403);
    }
    assert.equal((await User.findById(u.id).lean()).role, "USER");
  });

  it("malformed id is 400; unknown user is 404; reject body with role is 400", async () => {
    const admin = await makeUser("ADMIN");
    assert.equal((await request("POST", "/nope/approve", { token: admin.token })).status, 400);
    assert.equal((await request("POST", "/507f1f77bcf86cd799439011/approve", { token: admin.token })).status, 404);
    assert.equal(
      (await request("POST", "/507f1f77bcf86cd799439011/reject", { token: admin.token, body: { role: "EXPERT" } })).status,
      400,
    );
  });
});
