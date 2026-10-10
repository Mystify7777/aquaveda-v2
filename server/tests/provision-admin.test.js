import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../src/app.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { Knowledge } from "../src/models/Knowledge.js";
import { register } from "../src/services/auth.service.js";
import { createKnowledge, submitForReview } from "../src/services/knowledge.service.js";
import { provisionAdmin, ProvisioningRefusal } from "../scripts/provision-admin-lib.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * #89 — observable behavior of ADMIN provisioning against a real database,
 * and proof the provisioned account works through the REAL auth path
 * (login over HTTP) and the unchanged authorization model.
 */

const CFG = Object.freeze({
  name: "Local Admin",
  email: "admin@example.test",
  password: "local-dev-passphrase-1",
});

let server;
let baseUrl;

before(async () => {
  await setupTestDb();
  server = http.createServer(createApp());
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
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

async function loginToken({ email, password }) {
  const res = await request("POST", "/api/v1/auth/login", { body: { email, password } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const cookie = (res.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`));
  assert.ok(cookie, "login must set the access-token cookie");
  return cookie.split(";")[0].slice(ACCESS_TOKEN_COOKIE_NAME.length + 1);
}

describe("provisionAdmin: creation and idempotency", () => {
  it("creates exactly one ADMIN with a hashed password", async () => {
    const result = await provisionAdmin(CFG);
    assert.deepEqual(result, { outcome: "created", email: CFG.email });

    const doc = await User.findOne({ email: CFG.email }).select("+passwordHash").lean();
    assert.equal(doc.role, "ADMIN");
    assert.equal(doc.name, CFG.name);
    assert.notEqual(doc.passwordHash, CFG.password);
    assert.ok(!doc.passwordHash.includes(CFG.password));
    assert.equal(await Session.countDocuments({}), 0, "provisioning issues no sessions/tokens");
  });

  it("repeated runs are no-ops: one account, same document, no password change", async () => {
    await provisionAdmin(CFG);
    const before = await User.findOne({ email: CFG.email }).select("+passwordHash").lean();
    for (let i = 0; i < 3; i += 1) {
      const again = await provisionAdmin(CFG);
      assert.equal(again.outcome, "unchanged");
      assert.equal(again.passwordMatchesConfig, true);
    }
    assert.equal(await User.countDocuments({ email: CFG.email }), 1);
    const after = await User.findOne({ email: CFG.email }).select("+passwordHash").lean();
    assert.equal(after.passwordHash, before.passwordHash);
    assert.equal(String(after._id), String(before._id));
  });

  it("concurrent runs still yield exactly one ADMIN", async () => {
    const results = await Promise.all([provisionAdmin(CFG), provisionAdmin(CFG), provisionAdmin(CFG)]);
    assert.equal(results.filter((r) => r.outcome === "created").length, 1);
    assert.equal(await User.countDocuments({ email: CFG.email }), 1);
  });

  it("an existing ADMIN with a different password is not modified, and the mismatch is reported", async () => {
    await provisionAdmin(CFG);
    const before = await User.findOne({ email: CFG.email }).select("+passwordHash").lean();
    const result = await provisionAdmin({ ...CFG, password: "a-different-passphrase" });
    assert.equal(result.outcome, "unchanged");
    assert.equal(result.passwordMatchesConfig, false);
    assert.ok(!JSON.stringify(result).includes("a-different-passphrase"));
    const after = await User.findOne({ email: CFG.email }).select("+passwordHash").lean();
    assert.equal(after.passwordHash, before.passwordHash);
  });
});

describe("provisionAdmin: no accidental privilege escalation", () => {
  for (const role of ["USER", "EXPERT"]) {
    it(`refuses an existing ${role} account with the same email and leaves it untouched`, async () => {
      await User.create({ name: "Existing", email: CFG.email, passwordHash: "x-fixture-hash", role });
      await assert.rejects(provisionAdmin(CFG), (err) => {
        assert.ok(err instanceof ProvisioningRefusal);
        assert.match(err.message, new RegExp(role));
        assert.ok(!err.message.includes(CFG.password));
        return true;
      });
      const doc = await User.findOne({ email: CFG.email }).select("+passwordHash").lean();
      assert.equal(doc.role, role);
      assert.equal(doc.passwordHash, "x-fixture-hash");
      assert.equal(await User.countDocuments({}), 1);
    });
  }

  it("a registered USER is not elevated by provisioning their email", async () => {
    await register({ name: "Real User", email: CFG.email, password: CFG.password });
    await assert.rejects(provisionAdmin(CFG), ProvisioningRefusal);
    assert.equal((await User.findOne({ email: CFG.email }).lean()).role, "USER");
  });
});

describe("provisioned ADMIN works through the real auth + authorization path", () => {
  it("logs in with the bootstrap credentials; role ADMIN is recognized by the middleware", async () => {
    await provisionAdmin(CFG);
    const token = await loginToken(CFG);

    const me = await request("GET", "/api/v1/auth/me", { token });
    assert.equal(me.status, 200);
    assert.equal(me.json.data.user.role, "ADMIN");

    // ADMIN-only governance route (#91): the pending-application queue.
    const queue = await request("GET", "/api/v1/expert-application", { token });
    assert.equal(queue.status, 200);

    // Wrong password never authenticates.
    const bad = await request("POST", "/api/v1/auth/login", { body: { email: CFG.email, password: "wrong-password-x" } });
    assert.equal(bad.status, 401);
  });

  it("ADMIN governs: approves a real Expert application, producing a working EXPERT", async () => {
    await provisionAdmin(CFG);
    const adminToken = await loginToken(CFG);

    const { user, accessToken } = await register({
      name: "Applicant",
      email: "applicant@example.test",
      password: "applicant-passphrase-1",
    });
    const applicantId = String(user.id);
    assert.equal((await request("POST", "/api/v1/expert-application", { token: accessToken })).status, 201);
    const res = await request("POST", `/api/v1/expert-application/${applicantId}/approve`, { token: adminToken });
    assert.equal(res.status, 200);
    assert.equal((await User.findById(applicantId).lean()).role, "EXPERT");
  });

  it("ADMIN is NOT a Knowledge reviewer (#90): queue, approve and reject are 403", async () => {
    await provisionAdmin(CFG);
    const adminToken = await loginToken(CFG);

    const { user } = await register({
      name: "Author",
      email: "author@example.test",
      password: "author-passphrase-1",
    });
    const author = { id: String(user.id), role: "USER" };
    const k = await createKnowledge(author, { title: "Rain barrels", body: "Collect runoff." });
    await submitForReview(author, String(k._id));

    const KN = "/api/v1/knowledge";
    assert.equal((await request("GET", `${KN}/review-queue`, { token: adminToken })).status, 403);
    assert.equal((await request("POST", `${KN}/${k._id}/approve`, { token: adminToken })).status, 403);
    assert.equal(
      (await request("POST", `${KN}/${k._id}/reject`, { token: adminToken, body: { feedback: "no" } })).status,
      403,
    );
    assert.equal((await Knowledge.findById(k._id).lean()).status, "pending_review");
  });

  it("a plain USER still cannot reach ADMIN governance (authorization unchanged)", async () => {
    await provisionAdmin(CFG);
    const { accessToken } = await register({
      name: "Plain",
      email: "plain@example.test",
      password: "plain-passphrase-1",
    });
    assert.equal((await request("GET", "/api/v1/expert-application", { token: accessToken })).status, 403);
  });
});
