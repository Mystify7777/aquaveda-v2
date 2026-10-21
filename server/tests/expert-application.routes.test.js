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
import { validSubmission } from "./helpers/expert.js";
import { defaultStore } from "../src/middleware/rate-limiter.js";

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

beforeEach(async () => {
  // The apply route is IP rate-limited via the shared in-memory store.
  defaultStore.reset();
  await clearCollections();
});

const SUBMISSION = validSubmission();

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
  it("authentication precedes validation: anonymous callers get 401 whatever the body or id (never 400)", async () => {
    const id = "507f1f77bcf86cd799439011";
    const valid = validSubmission();
    for (const [m, p, body] of [
      ["POST", "", undefined],
      ["POST", "", {}],
      ["POST", "", { role: "EXPERT" }],
      ["POST", "", valid],
      ["POST", `/${id}/approve`, undefined],
      ["POST", `/${id}/approve`, { revision: "bad" }],
      ["POST", `/${id}/approve`, { revision: 1 }],
      ["POST", `/${id}/reject`, undefined],
      ["POST", `/${id}/reject`, { revision: 1, note: "short" }],
      ["POST", `/${id}/reject`, { revision: 1, note: "a valid long note" }],
      ["POST", "/not-an-id/approve", {}],
    ]) {
      const res = await request(m, p, body === undefined ? {} : { body });
      assert.equal(res.status, 401, `${m} ${p} ${JSON.stringify(body)}`);
      assert.equal(res.json.code, "UNAUTHORIZED");
      assert.ok(!JSON.stringify(res.json).includes("expertiseAreas"), "no validation detail for anonymous callers");
    }
  });

  it("anonymous apply attempts do not consume the apply rate limit", async () => {
    for (let i = 0; i < 12; i++) assert.equal((await request("POST", "", { body: {} })).status, 401);
    const u = await makeUser();
    assert.equal((await request("POST", "", { token: u.token, body: SUBMISSION })).status, 201);
  });

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

    const res = await request("POST", "", { token: u.token, body: SUBMISSION });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.status, "pending");

    const me = await request("GET", "/me", { token: u.token });
    assert.equal(me.json.data.status, "pending");
    assert.equal(me.json.data.history[0].fromStatus, null);
  });

  it("duplicate apply is 409 INVALID_STATE", async () => {
    const u = await makeUser();
    await request("POST", "", { token: u.token, body: SUBMISSION });
    const res = await request("POST", "", { token: u.token, body: SUBMISSION });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "INVALID_STATE");
  });

  it("client cannot self-assign EXPERT via the body: 400, and nothing changes", async () => {
    const u = await makeUser();
    for (const body of [
      { role: "EXPERT" },
      { status: "approved" },
      { expertApplication: { status: "approved" } },
      { ...SUBMISSION, role: "EXPERT" },
      { ...SUBMISSION, status: "approved" },
      { ...SUBMISSION, acknowledgement: { version: 1, acceptedAt: "2020-01-01T00:00:00Z" } },
      { ...SUBMISSION, acknowledgement: { version: 1, textSha256: "x" } },
    ]) {
      const res = await request("POST", "", { token: u.token, body });
      assert.equal(res.status, 400);
    }
    const doc = await User.findById(u.id).lean();
    assert.equal(doc.role, "USER");
    assert.equal(doc.expertApplication, undefined);
  });

  it("EXPERT applying is 403", async () => {
    const e = await makeUser("EXPERT");
    const res = await request("POST", "", { token: e.token, body: SUBMISSION });
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
    await request("POST", "", { token: u.token, body: SUBMISSION });

    const q = await request("GET", "", { token: admin.token });
    assert.deepEqual(q.json.data.items.map((i) => i.userId), [u.id]);

    const res = await request("POST", `/${u.id}/approve`, { token: admin.token, body: { revision: 1 } });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "approved");
    assert.equal((await User.findById(u.id).lean()).role, "EXPERT");
    assert.equal((await request("GET", "/me", { token: u.token })).json.data.status, "approved");

    const again = await request("POST", `/${u.id}/approve`, { token: admin.token, body: { revision: 2 } });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, "INVALID_STATE");
  });

  it("ADMIN rejects with note: no EXPERT; applicant sees the note and may re-apply", async () => {
    const admin = await makeUser("ADMIN");
    const u = await makeUser();
    await request("POST", "", { token: u.token, body: SUBMISSION });
    const res = await request("POST", `/${u.id}/reject`, { token: admin.token, body: { revision: 1, note: "add more detail please" } });
    assert.equal(res.status, 200);
    assert.equal((await User.findById(u.id).lean()).role, "USER");

    const me = await request("GET", "/me", { token: u.token });
    assert.equal(me.json.data.status, "rejected");
    assert.equal(me.json.data.history.at(-1).note, "add more detail please");

    assert.equal((await request("POST", "", { token: u.token, body: SUBMISSION })).status, 201);
  });

  it("non-ADMIN cannot approve/reject (403) — including the applicant themself", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const expert = await makeUser("EXPERT");
    await request("POST", "", { token: u.token, body: SUBMISSION });
    for (const actor of [u, other, expert]) {
      assert.equal(
        (await request("POST", `/${u.id}/approve`, { token: actor.token, body: { revision: 1 } })).status,
        403,
      );
      assert.equal(
        (await request("POST", `/${u.id}/reject`, { token: actor.token, body: { revision: 1, note: "not allowed anyway" } })).status,
        403,
      );
    }
    assert.equal((await User.findById(u.id).lean()).role, "USER");
  });

  it("malformed id is 400; unknown user is 404; reject body with role is 400", async () => {
    const admin = await makeUser("ADMIN");
    assert.equal((await request("POST", "/nope/approve", { token: admin.token, body: { revision: 1 } })).status, 400);
    assert.equal(
      (await request("POST", "/507f1f77bcf86cd799439011/approve", { token: admin.token, body: { revision: 1 } })).status,
      404,
    );
    assert.equal(
      (await request("POST", "/507f1f77bcf86cd799439011/reject", { token: admin.token, body: { revision: 1, note: "long enough note", role: "EXPERT" } })).status,
      400,
    );
  });
});

// ---------------------------------------------------------------------------
// EXP-L9+ / EXP-L10+: submission contract, DTOs, revision pinning, rate limit
// ---------------------------------------------------------------------------
describe("apply: submission contract (strict, 400 with field paths)", () => {
  const bad = [
    ["empty body", {}],
    ["no areas", { ...SUBMISSION, expertiseAreas: [] }],
    ["4 areas", { ...SUBMISSION, expertiseAreas: ["groundwater_wells", "other", "policy_governance", "wastewater_sanitation"] }],
    ["unknown area", { ...SUBMISSION, expertiseAreas: ["astrology"] }],
    ["duplicate area", { ...SUBMISSION, expertiseAreas: ["other", "other"] }],
    ["79-char experience", { ...SUBMISSION, experience: "x".repeat(79) }],
    ["1001-char experience", { ...SUBMISSION, experience: "x".repeat(1001) }],
    ["empty affiliation", { ...SUBMISSION, affiliation: "" }],
    ["121-char affiliation", { ...SUBMISSION, affiliation: "a".repeat(121) }],
    ["4 references", { ...SUBMISSION, references: ["https://a.org", "https://b.org", "https://c.org", "https://d.org"] }],
    ["http reference", { ...SUBMISSION, references: ["http://a.org"] }],
    ["userinfo reference", { ...SUBMISSION, references: ["https://user:pw@a.org"] }],
    ["javascript reference", { ...SUBMISSION, references: ["javascript:alert(1)"] }],
    ["no acknowledgement", { ...SUBMISSION, acknowledgement: undefined }],
    ["stale acknowledgement version", { ...SUBMISSION, acknowledgement: { version: 0 } }],
  ];
  for (const [name, body] of bad) {
    it(`${name}: 400 and nothing persisted`, async () => {
      const u = await makeUser();
      const res = await request("POST", "", { token: u.token, body });
      assert.equal(res.status, 400);
      assert.equal((await User.findById(u.id).lean()).expertApplication, undefined);
    });
  }

  it("persists the submission with a SERVER-computed acknowledgement hash and time; DTO hides the hash", async () => {
    const u = await makeUser();
    const res = await request("POST", "", {
      token: u.token,
      body: { ...SUBMISSION, affiliation: "  River Trust  ", references: ["https://example.org/a", "https://example.org/a"] },
    });
    assert.equal(res.status, 201);
    const sub = res.json.data.history[0].submission;
    assert.equal(sub.affiliation, "River Trust");
    assert.deepEqual(sub.references, ["https://example.org/a"]);
    assert.equal(sub.acknowledgement.version, 1);
    assert.ok(!("textSha256" in sub.acknowledgement));

    const stored = (await User.findById(u.id).lean()).expertApplication.history[0].submission;
    assert.match(stored.acknowledgement.textSha256, /^[0-9a-f]{64}$/);
    assert.ok(stored.acknowledgement.acceptedAt instanceof Date);
  });
});

describe("apply: rate limit", () => {
  it("the 11th apply attempt from one IP in the window is 429 (standard envelope)", async () => {
    const u = await makeUser();
    let last;
    for (let i = 0; i < 11; i++) {
      // invalid bodies still count: the limiter runs before validation
      last = await request("POST", "", { token: u.token, body: {} });
    }
    assert.equal(last.status, 429);
    assert.equal(last.json.success, false);
  });
});

describe("reviewer DTO and revision-pinned decisions", () => {
  async function pendingApplicant() {
    const u = await makeUser();
    assert.equal((await request("POST", "", { token: u.token, body: SUBMISSION })).status, 201);
    return u;
  }

  it("queue item carries revision and the matching submission; total ignores limit", async () => {
    const admin = await makeUser("ADMIN");
    for (let i = 0; i < 3; i++) await pendingApplicant();
    const res = await request("GET", "?page=1&limit=1", { token: admin.token });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.items.length, 1);
    assert.equal(res.json.data.total, 3);
    const item = res.json.data.items[0];
    assert.equal(item.revision, 1);
    assert.equal(item.submission.experience, SUBMISSION.experience);
    assert.ok(!("email" in item), "email stays excluded (EXP-L6)");
    assert.ok(!("textSha256" in item.submission.acknowledgement));
  });

  it("revision is required and validated: missing / 0 / string / float / oversized => 400, nothing changes", async () => {
    const admin = await makeUser("ADMIN");
    const u = await pendingApplicant();
    for (const body of [{}, { revision: 0 }, { revision: "1" }, { revision: 1.5 }, { revision: 10_001 }, { revision: -1 }]) {
      for (const action of ["approve", "reject"]) {
        const res = await request("POST", `/${u.id}/${action}`, {
          token: admin.token,
          body: action === "reject" ? { ...body, note: "valid long note" } : body,
        });
        assert.equal(res.status, 400, `${action} ${JSON.stringify(body)}`);
      }
    }
    const doc = await User.findById(u.id).lean();
    assert.equal(doc.role, "USER");
    assert.equal(doc.expertApplication.status, "pending");
    assert.equal(doc.expertApplication.history.length, 1);
  });

  it("reject note: required, trimmed, 10..500 (whitespace-only, 9, 10, 500, 501, unknown keys)", async () => {
    const admin = await makeUser("ADMIN");
    const u = await pendingApplicant();
    const reject = (body) => request("POST", `/${u.id}/reject`, { token: admin.token, body: { revision: 1, ...body } });
    for (const note of [undefined, "          ", "123456789", "  123456789  ", "x".repeat(501)]) {
      assert.equal((await reject(note === undefined ? {} : { note })).status, 400, JSON.stringify(note));
    }
    assert.equal((await reject({ note: "12345678", extra: 1 })).status, 400);
    assert.equal((await reject({ note: "valid long note", extra: 1 })).status, 400);
    assert.equal((await request("POST", `/${u.id}/reject`, { token: admin.token, body: { revision: 1, note: "x".repeat(500) } })).status, 200);
  });

  it("reject trims and persists the note; ten characters after trim is accepted", async () => {
    const admin = await makeUser("ADMIN");
    const u = await pendingApplicant();
    const res = await request("POST", `/${u.id}/reject`, { token: admin.token, body: { revision: 1, note: "   0123456789   " } });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.history.at(-1).note, "0123456789");
  });

  it("approve note is optional but, when present, trimmed 1..500 (whitespace-only and 501 are 400)", async () => {
    const admin = await makeUser("ADMIN");
    const u = await pendingApplicant();
    const approve = (body) => request("POST", `/${u.id}/approve`, { token: admin.token, body: { revision: 1, ...body } });
    assert.equal((await approve({ note: "   " })).status, 400);
    assert.equal((await approve({ note: "x".repeat(501) })).status, 400);
    const ok = await approve({ note: "  Welcome aboard  " });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.history.at(-1).note, "Welcome aboard");
  });

  it("STALE decision: A holds revision 1, B rejects, applicant re-applies, A's approve => 409 STATE_RACE; state and role unchanged", async () => {
    const adminA = await makeUser("ADMIN");
    const adminB = await makeUser("ADMIN");
    const u = await pendingApplicant();

    const seenByA = (await request("GET", "", { token: adminA.token })).json.data.items[0];
    assert.equal(seenByA.revision, 1);

    assert.equal(
      (await request("POST", `/${u.id}/reject`, { token: adminB.token, body: { revision: 1, note: "please add references" } })).status,
      200,
    );
    const resubmit = { ...SUBMISSION, experience: `${SUBMISSION.experience} Added a second district programme.` };
    assert.equal((await request("POST", "", { token: u.token, body: resubmit })).status, 201);

    const before = await User.findById(u.id).lean();
    assert.equal(before.expertApplication.history.length, 3);

    const stale = await request("POST", `/${u.id}/approve`, { token: adminA.token, body: { revision: seenByA.revision } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, "STATE_RACE");

    const after = await User.findById(u.id).lean();
    assert.equal(after.role, "USER", "stale approve must not grant EXPERT");
    assert.equal(after.expertApplication.status, "pending");
    assert.equal(after.expertApplication.history.length, 3, "stale approve must not append history");

    const fresh = (await request("GET", "", { token: adminA.token })).json.data.items[0];
    assert.equal(fresh.revision, 3);
    assert.match(fresh.submission.experience, /second district programme/);
    assert.equal((await request("POST", `/${u.id}/approve`, { token: adminA.token, body: { revision: 3 } })).status, 200);
  });

  it("competing approve and reject on the same revision: exactly one wins, the other is 409; role matches the winner", async () => {
    const admin1 = await makeUser("ADMIN");
    const admin2 = await makeUser("ADMIN");
    const u = await pendingApplicant();
    const [a, r] = await Promise.all([
      request("POST", `/${u.id}/approve`, { token: admin1.token, body: { revision: 1 } }),
      request("POST", `/${u.id}/reject`, { token: admin2.token, body: { revision: 1, note: "competing decision" } }),
    ]);
    const statuses = [a.status, r.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = a.status === 409 ? a : r;
    assert.ok(["STATE_RACE", "INVALID_STATE"].includes(loser.json.code));
    const doc = await User.findById(u.id).lean();
    assert.equal(doc.expertApplication.history.length, 2, "exactly one decision entry");
    assert.equal(doc.role, a.status === 200 ? "EXPERT" : "USER");
  });

  it("legacy pending application (no submission): queue shows submission:null and it remains decidable", async () => {
    const admin = await makeUser("ADMIN");
    const u = await makeUser();
    await User.updateOne(
      { _id: u.id },
      { $set: { expertApplication: { status: "pending", history: [{ fromStatus: null, toStatus: "pending", actor: u.id, timestamp: new Date() }] } } },
    );
    const item = (await request("GET", "", { token: admin.token })).json.data.items[0];
    assert.equal(item.submission, null);
    assert.equal(item.revision, 1);
    assert.equal(item.history[0].submission, null, "legacy entry: key present, value null");
    assert.equal((await request("POST", `/${u.id}/approve`, { token: admin.token, body: { revision: 1 } })).status, 200);
  });
});
