import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { User } from "../src/models/User.js";
import { GovernanceEvent } from "../src/models/GovernanceEvent.js";
import { register } from "../src/services/auth.service.js";
import {
  muteAccount,
  liftMute,
  suspendAccount,
} from "../src/services/account-governance.service.js";
import {
  listAccountDirectory,
  listAccountGovernanceHistory,
} from "../src/services/account-directory.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { defaultStore } from "../src/middleware/rate-limiter.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import { planTokens, hasIndex, scansCollection } from "./helpers/queryPlan.js";

/** #181 — Admin directory read API. Real app, real middleware, real MongoDB. */

const ORIGIN = "http://allowed.example.com";
const PASSWORD = "correcthorsebatterystaple";
const HOUR = 3_600_000;
const PRIVATE = "PRIVATE-REASON-SHOULD-NEVER-LEAK";
let server;
let baseUrl;
let n = 0;

before(async () => {
  process.env.ALLOWED_ORIGINS = ORIGIN;
  await setupTestDb();
  await GovernanceEvent.init();
  await User.init();
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardownTestDb();
});
beforeEach(async () => {
  defaultStore.reset();
  await clearCollections();
});

async function makeUser(role = "USER", name = "Person") {
  const email = `dir-${Date.now()}-${n++}@example.test`;
  const { accessToken } = await register({ name, email, password: PASSWORD });
  const user = await User.findOne({ email });
  if (role !== "USER") await User.updateOne({ _id: user._id }, { $set: { role } });
  return { id: String(user._id), actor: { id: user._id, role }, token: accessToken, email };
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const headers = { Origin: ORIGIN };
    if (token) headers.Cookie = `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
    const req = http.request(`${baseUrl}${path}`, { method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const bulk = (count, overrides = () => ({})) =>
  User.insertMany(
    Array.from({ length: count }, (_, i) => ({
      name: `Bulk ${i}`,
      email: `bulk-${n++}-${i}@example.test`,
      passwordHash: "x",
      ...overrides(i),
    })),
  );

const ENTRY_KEYS = [
  "accountState", "accountStateChangedAt", "deletionPending", "deletionRequestedAt",
  "email", "id", "name", "registeredAt", "restriction", "role",
];

describe("authorization", () => {
  const paths = (id) => ["/api/v1/accounts", `/api/v1/accounts/${id}`, `/api/v1/accounts/${id}/history`];

  it("anonymous 401, USER 403, EXPERT 403, ADMIN 200 on every route", async () => {
    const admin = await makeUser("ADMIN");
    const user = await makeUser("USER");
    const expert = await makeUser("EXPERT");
    for (const p of paths(user.id)) {
      assert.equal((await get(p)).status, 401, `anon ${p}`);
      assert.equal((await get(p, user.token)).status, 403, `user ${p}`);
      assert.equal((await get(p, expert.token)).status, 403, `expert ${p}`);
      assert.equal((await get(p, admin.token)).status, 200, `admin ${p}`);
    }
  });

  it("denied callers get no directory data and no field detail (auth precedes validation)", async () => {
    const user = await makeUser("USER");
    const r = await get("/api/v1/accounts?bogus=1", user.token);
    assert.equal(r.status, 403); // authorization precedes validation: no field detail
    assert.ok(!r.text.includes(user.email));
    for (const p of ["/api/v1/accounts/not-an-id", "/api/v1/accounts/not-an-id/history?bogus=1"]) {
      assert.equal((await get(p, user.token)).status, 403, p);
      assert.equal((await get(p)).status, 401, p);
    }
    const anon = await get("/api/v1/accounts?bogus=1");
    assert.equal(anon.status, 401);
  });

  it("service rejects non-ADMIN and missing actor directly", async () => {
    await assert.rejects(() => listAccountDirectory(null), { code: DomainErrorCode.UNAUTHORIZED });
    await assert.rejects(() => listAccountDirectory({ id: new mongoose.Types.ObjectId(), role: "EXPERT" }), {
      code: DomainErrorCode.FORBIDDEN,
    });
  });

  it("no mutation surface: PATCH/PUT/DELETE/POST on directory paths do not succeed", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser("USER");
    for (const method of ["PATCH", "PUT", "DELETE", "POST"]) {
      const r = await new Promise((resolve, reject) => {
        const req = http.request(
          `${baseUrl}/api/v1/accounts/${target.id}`,
          { method, headers: { Origin: ORIGIN, Cookie: `${ACCESS_TOKEN_COOKIE_NAME}=${admin.token}` } },
          (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); },
        );
        req.on("error", reject);
        req.end();
      });
      assert.ok(r >= 400, `${method} -> ${r}`);
    }
    assert.equal((await User.findById(target.id)).role, "USER");
  });
});

describe("directory entry projection and leakage", () => {
  it("exposes exactly the allowlisted keys and no sensitive data", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser("USER");
    await User.updateOne({ _id: target.id }, { $set: { bio: "SECRET-BIO", authGeneration: 7 } });
    await suspendAccount(admin.actor, target.id, { kind: "INDEFINITE", reason: PRIVATE, safeReason: "Policy breach" });

    const list = await get("/api/v1/accounts", admin.token);
    const detail = await get(`/api/v1/accounts/${target.id}`, admin.token);
    for (const r of [list, detail]) {
      assert.equal(r.status, 200);
      for (const banned of [PRIVATE, "SECRET-BIO", "passwordHash", "authGeneration", "accountStateVersion", "expertApplication", "bio", "idempotencyKey"]) {
        assert.ok(!r.text.includes(banned), `leaked ${banned}`);
      }
    }
    const entry = detail.json.data;
    assert.deepEqual(Object.keys(entry).sort(), ENTRY_KEYS);
    assert.deepEqual(Object.keys(entry.restriction).sort(), ["expiresAt", "kind", "lapsed", "safeReason"]);
    assert.equal(entry.accountState, "HARD_SUSPENDED");
    assert.equal(entry.restriction.kind, "INDEFINITE");
    assert.equal(entry.restriction.safeReason, "Policy breach");
    assert.equal(entry.restriction.expiresAt, null);
    assert.equal(entry.restriction.lapsed, false);
    assert.equal(entry.email, target.email);
    assert.deepEqual(Object.keys(list.json.data).sort(), ["items", "limit", "page", "total", "totalPages"]);
  });

  it("ACTIVE legacy user: null restriction, no state timestamp", async () => {
    const admin = await makeUser("ADMIN");
    const t = await makeUser("USER");
    const e = (await get(`/api/v1/accounts/${t.id}`, admin.token)).json.data;
    assert.equal(e.restriction, null);
    assert.equal(e.accountStateChangedAt, null);
    assert.equal(e.deletionPending, false);
  });

  it("lapsed TEMPORARY restriction is flagged, and reading never mutates state or writes events", async () => {
    const admin = await makeUser("ADMIN");
    const t = await makeUser("USER");
    const expiresAt = new Date(Date.now() + HOUR);
    await muteAccount(admin.actor, t.id, { expiresAt, reason: "r" }, { now: new Date(Date.now() - HOUR) });
    const before = await User.collection.findOne({ _id: t._id ?? new mongoose.Types.ObjectId(t.id) });
    const eventsBefore = await GovernanceEvent.collection.countDocuments();

    const at = new Date(Date.now() + 3 * HOUR);
    const page = await listAccountDirectory(admin.actor, { role: "USER", accountState: "MUTED" }, { now: at });
    assert.equal(page.items[0].restriction.lapsed, true);
    assert.equal(page.items[0].accountState, "MUTED"); // persisted state, not effective

    const after = await User.collection.findOne({ _id: before._id });
    assert.deepEqual(after, before);
    assert.equal(await GovernanceEvent.collection.countDocuments(), eventsBefore);
  });

  it("DELETION_PENDING is identified and filterable", async () => {
    const admin = await makeUser("ADMIN");
    const t = await makeUser("USER");
    const changedAt = new Date(Date.now() - HOUR);
    await User.updateOne({ _id: t.id }, { $set: { accountState: "DELETION_PENDING", accountStateChangedAt: changedAt } });
    const r = await get("/api/v1/accounts?accountState=DELETION_PENDING", admin.token);
    assert.equal(r.json.data.total, 1);
    const e = r.json.data.items[0];
    assert.equal(e.deletionPending, true);
    assert.equal(e.deletionRequestedAt, changedAt.toISOString());
  });
});

describe("pagination, filtering, search", () => {
  it("is deterministic: createdAt DESC then _id DESC, including identical timestamps; no duplicates across pages", async () => {
    const admin = await makeUser("ADMIN");
    const ts = new Date(Date.now() - 5 * HOUR);
    await bulk(7, () => ({ createdAt: ts }));
    const seen = [];
    let total;
    for (let p = 1; p <= 3; p++) {
      const r = (await get(`/api/v1/accounts?limit=3&page=${p}`, admin.token)).json.data;
      total = r.total;
      assert.equal(r.totalPages, 3);
      seen.push(...r.items.map((i) => i.id));
    }
    assert.equal(total, 8);
    assert.equal(new Set(seen).size, 8);
    assert.equal(seen[0], String(admin.actor.id)); // newest first
    const tied = seen.slice(1);
    assert.deepEqual(tied, [...tied].sort().reverse()); // _id DESC among equal createdAt
    const past = (await get("/api/v1/accounts?limit=3&page=9", admin.token)).json.data;
    assert.deepEqual(past.items, []);
    assert.equal(past.total, 8);
  });

  it("directory and history queries use the total order (createdAt|occurredAt DESC, _id DESC) explicitly", async () => {
    const admin = await makeUser("ADMIN");
    const t = await makeUser("USER");
    const specs = [];
    const orig = mongoose.Query.prototype.sort;
    mongoose.Query.prototype.sort = function (spec) { specs.push(spec); return orig.call(this, spec); };
    try {
      await listAccountDirectory(admin.actor, { q: "zz" });
      await listAccountGovernanceHistory(admin.actor, t.id, {});
    } finally {
      mongoose.Query.prototype.sort = orig;
    }
    assert.deepEqual(specs, [{ createdAt: -1, _id: -1 }, { occurredAt: -1, _id: -1 }]);
  });

  it("role and accountState filters combine with AND; invalid values and unknown params are 400", async () => {
    const admin = await makeUser("ADMIN");
    await bulk(2, () => ({ role: "EXPERT" }));
    await bulk(1, () => ({ role: "EXPERT", accountState: "MUTED", accountStateChangedAt: new Date(), accountRestriction: { kind: "TEMPORARY", expiresAt: new Date(Date.now() + HOUR) } }));
    const r = (path) => get(path, admin.token);
    assert.equal((await r("/api/v1/accounts?role=EXPERT")).json.data.total, 3);
    assert.equal((await r("/api/v1/accounts?role=EXPERT&accountState=MUTED")).json.data.total, 1);
    assert.equal((await r("/api/v1/accounts?role=ADMIN&accountState=MUTED")).json.data.total, 0);
    for (const bad of ["role=SUPER", "accountState=BANNED", "state=MUTED", "limit=51", "limit=0", "page=0", "q=a", `q=${"x".repeat(101)}`, "role=USER&role=ADMIN"]) {
      assert.equal((await r(`/api/v1/accounts?${bad}`)).status, 400, bad);
    }
  });

  it("q: case-insensitive email prefix, name prefix, exact id; trimmed; not a substring match", async () => {
    const admin = await makeUser("ADMIN", "Zed Admin");
    await User.insertMany([
      { name: "Ananya Rao", email: "ananya.rao@example.test", passwordHash: "x" },
      { name: "Bob", email: "BOB@example.test", passwordHash: "x" },
    ]);
    const ids = async (q) => (await get(`/api/v1/accounts?q=${encodeURIComponent(q)}`, admin.token)).json.data.items.map((i) => i.email);
    assert.deepEqual(await ids("ANAN"), ["ananya.rao@example.test"]); // name prefix, case-insensitive
    assert.deepEqual(await ids("ananya.r"), ["ananya.rao@example.test"]); // email prefix
    assert.deepEqual(await ids("  bob@  "), ["bob@example.test"]); // trimmed, email case-folded
    assert.deepEqual(await ids("rao"), []); // prefix, not substring
    const target = await User.findOne({ email: "bob@example.test" });
    assert.deepEqual(await ids(String(target._id)), ["bob@example.test"]); // exact id
  });

  it("q is regex-safe: metacharacters are literals", async () => {
    const admin = await makeUser("ADMIN");
    await bulk(3);
    for (const q of [".*", "^.", "((", "[a-z]+", "\\\\", "a|b", "bulk-.*"]) {
      const r = await get(`/api/v1/accounts?q=${encodeURIComponent(q)}`, admin.token);
      assert.equal(r.status, 200, q);
      assert.equal(r.json.data.total, 0, q);
    }
  });

  it("unfiltered ordered list uses user_directory_order (no collection scan)", async () => {
    const plan = await User.find({}).sort({ createdAt: -1, _id: -1 }).limit(20).explain("queryPlanner");
    const tokens = planTokens(plan);
    assert.ok(hasIndex(tokens, "user_directory_order"), tokens.join(","));
    assert.ok(!scansCollection(tokens));
  });
});

describe("governance history", () => {
  it("lists target events newest first with safe actor projection and no private data", async () => {
    const adminA = await makeUser("ADMIN", "Admin A");
    const adminB = await makeUser("ADMIN", "Admin B");
    const t = await makeUser("USER");
    const exp = () => new Date(Date.now() + 2 * HOUR);
    await muteAccount(adminA.actor, t.id, { expiresAt: exp(), reason: PRIVATE, safeReason: "Be civil" });
    await liftMute(adminB.actor, t.id, { reason: PRIVATE });
    await suspendAccount(adminA.actor, t.id, { kind: "INDEFINITE", reason: PRIVATE });
    // another account's events must not appear
    const other = await makeUser("USER");
    await muteAccount(adminA.actor, other.id, { expiresAt: exp(), reason: "x" });

    const r = await get(`/api/v1/accounts/${t.id}/history`, adminA.token);
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes(PRIVATE));
    for (const banned of ["idempotencyKey", "references", "\"reason\""]) assert.ok(!r.text.includes(banned), banned);
    const { items, total } = r.json.data;
    assert.equal(total, 3);
    assert.deepEqual(items.map((i) => i.action), ["HARD_SUSPEND", "MUTE_LIFTED", "MUTE"]);
    for (const i of items) {
      assert.deepEqual(Object.keys(i).sort(), ["action", "actor", "actorType", "id", "occurredAt", "previousState", "resultingState", "safeReason"]);
    }
    assert.deepEqual(items[1].actor, { id: adminB.id, name: "Admin B" });
    assert.equal(items[2].safeReason, "Be civil");
    assert.equal(items[0].previousState, "ACTIVE");
    assert.equal(items[0].resultingState, "HARD_SUSPENDED");
  });

  it("SYSTEM events have a null actor; pagination is deterministic", async () => {
    const admin = await makeUser("ADMIN");
    const t = await makeUser("USER");
    const base = Date.now() - 10 * HOUR;
    await GovernanceEvent.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        idempotencyKey: `k-${t.id}-${i}`,
        action: "MUTE_LIFTED",
        actorType: "SYSTEM",
        target: t.id,
        previousState: "MUTED",
        resultingState: "ACTIVE",
        occurredAt: new Date(base + (i % 2) * HOUR), // ties
      })),
    );
    const pages = [];
    for (const p of [1, 2, 3]) pages.push((await get(`/api/v1/accounts/${t.id}/history?limit=2&page=${p}`, admin.token)).json.data);
    const ids = pages.flatMap((p) => p.items.map((i) => i.id));
    assert.equal(new Set(ids).size, 5);
    assert.equal(pages[0].totalPages, 3);
    assert.ok(pages.flatMap((p) => p.items).every((i) => i.actor === null && i.actorType === "SYSTEM"));
    const times = pages.flatMap((p) => p.items.map((i) => i.occurredAt));
    assert.deepEqual(times, [...times].sort().reverse());
  });

  it("hydrates actors with at most one User query per page (no N+1)", async () => {
    const admins = [await makeUser("ADMIN", "A1"), await makeUser("ADMIN", "A2"), await makeUser("ADMIN", "A3")];
    const t = await makeUser("USER");
    for (const [i, a] of admins.entries()) {
      await GovernanceEvent.create({
        idempotencyKey: `n1-${i}-${t.id}`, action: "MUTE", actorType: "USER", actor: a.actor.id,
        target: t.id, previousState: "ACTIVE", resultingState: "MUTED",
      });
    }
    const orig = User.find;
    let calls = 0;
    User.find = function (...args) { calls++; return orig.apply(this, args); };
    try {
      const r = await listAccountGovernanceHistory(admins[0].actor, t.id, { page: 1, limit: 20 });
      assert.equal(r.items.length, 3);
      assert.deepEqual(r.items.map((i) => i.actor.name).sort(), ["A1", "A2", "A3"]);
    } finally {
      User.find = orig;
    }
    assert.equal(calls, 1);
  });

  it("unknown account 404, malformed id 400; empty history is a successful empty page", async () => {
    const admin = await makeUser("ADMIN");
    const t = await makeUser("USER");
    assert.equal((await get(`/api/v1/accounts/${new mongoose.Types.ObjectId()}`, admin.token)).status, 404);
    assert.equal((await get(`/api/v1/accounts/${new mongoose.Types.ObjectId()}/history`, admin.token)).status, 404);
    assert.equal((await get("/api/v1/accounts/not-an-id", admin.token)).status, 400);
    assert.equal((await get("/api/v1/accounts/not-an-id/history", admin.token)).status, 400);
    const empty = (await get(`/api/v1/accounts/${t.id}/history`, admin.token)).json.data;
    assert.deepEqual([empty.items, empty.total, empty.totalPages], [[], 0, 0]);
    assert.equal((await get(`/api/v1/accounts/${t.id}/history?bogus=1`, admin.token)).status, 400);
  });
});
