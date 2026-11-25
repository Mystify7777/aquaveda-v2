import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { authMiddleware, ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { accountStateMiddleware } from "../src/middleware/account-state.js";
import {
  contributionRestrictionMiddleware,
  NON_CONTRIBUTION_WRITE_ALLOWLIST,
} from "../src/middleware/contribution-restriction.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { GovernanceEvent } from "../src/models/GovernanceEvent.js";
import { register } from "../src/services/auth.service.js";
import {
  muteAccount,
  liftMute,
  expireMuteIfDue,
  liftExpiredMutes,
} from "../src/services/account-governance.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { defaultStore } from "../src/middleware/rate-limiter.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * #174 — MUTE enforcement and expiration. Real app, real middleware order,
 * real MongoDB. Positive and negative authorization across every existing
 * contribution surface.
 */

const ALLOWED_ORIGIN = "http://allowed.example.com";
let server;
let baseUrl;

before(async () => {
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;
  await setupTestDb();
  await GovernanceEvent.init();
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

const HOUR = 3_600_000;
const oid = () => new mongoose.Types.ObjectId();
let n = 0;

async function makeUser(role = "USER") {
  const email = `mute-${Date.now()}-${n++}@example.test`;
  const { accessToken, refreshToken } = await register({ name: "U", email, password: "correcthorsebatterystaple" });
  const user = await User.findOne({ email });
  if (role !== "USER") await User.updateOne({ _id: user._id }, { $set: { role } });
  return { id: String(user._id), actor: { id: user._id, role }, accessToken, refreshToken, email };
}

function request(base, method, path, { body, token, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = { Origin: ALLOWED_ORIGIN };
    if (bodyStr !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }
    const jar = { ...(cookies ?? {}) };
    if (token) jar[ACCESS_TOKEN_COOKIE_NAME] = token;
    if (Object.keys(jar).length) headers.Cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const req = http.request(`${base}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, json, text: raw });
      });
    });
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}
const call = (method, path, opts) => request(baseUrl, method, path, opts);

const future = (hours = 1) => new Date(Date.now() + hours * HOUR);
const eventsFor = (target, action) =>
  GovernanceEvent.collection.find({ target: new mongoose.Types.ObjectId(String(target)), ...(action ? { action } : {}) }).toArray();

/** Every write route that exists behind the guard, by Express route pattern. */
const WRITE_ROUTES = [
  "POST /api/v1/issues/",
  "POST /api/v1/issues/:issueId/disposition",
            "POST /api/v1/issues/:issueId/acknowledge",
  "POST /api/v1/issues/:issueId/start",
  "POST /api/v1/issues/:issueId/resolve",
  "POST /api/v1/issues/:issueId/verify",
  "POST /api/v1/issues/:issueId/fail-verification",

  "POST /api/v1/issues/:issueId/remediation/grant",
  "POST /api/v1/issues/:issueId/remediation/accept",
  "POST /api/v1/issues/:issueId/remediation/decline",
  "POST /api/v1/issues/:issueId/remediation/release",
  "POST /api/v1/issues/:issueId/remediation/withdraw",
  "POST /api/v1/issues/:issueId/remediation/revoke",
  "POST /api/v1/comments/",
  "POST /api/v1/discussions/",
  "POST /api/v1/discussions/:discussionId/reports",
  "POST /api/v1/discussions/:discussionId/hide",
  "POST /api/v1/discussions/:discussionId/unhide",
  "POST /api/v1/knowledge/",
  "POST /api/v1/knowledge/:knowledgeId/submit",
  "POST /api/v1/knowledge/:knowledgeId/approve",
  "POST /api/v1/knowledge/:knowledgeId/reject",
  "POST /api/v1/knowledge/:knowledgeId/revise",
  "POST /api/v1/projects/",
  "POST /api/v1/expert-application/",
  "POST /api/v1/expert-application/:userId/approve",
  "POST /api/v1/expert-application/:userId/reject",
  "POST /api/v1/accounts/:userId/mute",
  "POST /api/v1/accounts/:userId/mute/lift",
  "POST /api/v1/accounts/:userId/suspend",
  "POST /api/v1/accounts/:userId/suspend/lift",
];

describe("MUTE service — mute / lift", () => {
  it("mutes an ACTIVE account: persisted state, version, restriction, one MUTE event, sessions untouched", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const sessionsBefore = await Session.countDocuments({ userId: target.id });
    const expiresAt = future(2);

    const res = await muteAccount(admin.actor, target.id, { expiresAt, reason: "PRIVATE", safeReason: "Please review the guidelines." });

    const raw = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(target.id) });
    assert.equal(raw.accountState, "MUTED");
    assert.equal(raw.accountStateVersion, 1);
    assert.ok(raw.accountStateChangedAt instanceof Date);
    assert.equal(raw.accountRestriction.kind, "TEMPORARY");
    assert.deepEqual(raw.accountRestriction.expiresAt, expiresAt);
    assert.equal(raw.accountRestriction.safeReason, "Please review the guidelines.");
    assert.equal(await Session.countDocuments({ userId: target.id }), sessionsBefore, "MUTE must not invalidate sessions");

    const events = await eventsFor(target.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "MUTE");
    assert.equal(events[0].actorType, "USER");
    assert.equal(String(events[0].actor), admin.id);
    assert.equal(events[0].previousState, "ACTIVE");
    assert.equal(events[0].resultingState, "MUTED");
    assert.equal(events[0].reason, "PRIVATE");
    assert.equal(events[0].idempotencyKey, `MUTE:${target.id}:1`);
    assert.equal(res.eventId, String(events[0]._id));
    assert.equal(res.accountState, "MUTED");
  });

  it("is ADMIN-only: anonymous, USER and EXPERT are rejected and nothing changes", async () => {
    const target = await makeUser();
    const user = await makeUser();
    const expert = await makeUser("EXPERT");
    await assert.rejects(() => muteAccount(null, target.id, { expiresAt: future() }), { code: DomainErrorCode.UNAUTHORIZED });
    await assert.rejects(() => muteAccount(user.actor, target.id, { expiresAt: future() }), { code: DomainErrorCode.FORBIDDEN });
    await assert.rejects(() => muteAccount(expert.actor, target.id, { expiresAt: future() }), { code: DomainErrorCode.FORBIDDEN });
    assert.equal((await User.findById(target.id)).accountState, "ACTIVE");
    assert.equal((await eventsFor(target.id)).length, 0);
  });

  it("validates input before any write", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    for (const bad of [
      {},
      { expiresAt: "nope" },
      { expiresAt: new Date(Date.now() - HOUR) },
      { expiresAt: future(), safeReason: "x".repeat(501) },
      { expiresAt: future(), reason: "   " },
    ]) {
      await assert.rejects(() => muteAccount(admin.actor, target.id, bad), { code: DomainErrorCode.VALIDATION_FAILED });
    }
    await assert.rejects(() => muteAccount(admin.actor, "not-an-id", { expiresAt: future() }), { code: DomainErrorCode.VALIDATION_FAILED });
    assert.equal((await User.findById(target.id)).accountState, "ACTIVE");
    assert.equal((await eventsFor(target.id)).length, 0);
  });

  it("only an ACTIVE account can be muted; unknown target is NOT_FOUND; failures record no event", async () => {
    const admin = await makeUser("ADMIN");
    await assert.rejects(() => muteAccount(admin.actor, String(oid()), { expiresAt: future() }), { code: DomainErrorCode.NOT_FOUND });
    for (const state of ["MUTED", "HARD_SUSPENDED", "DELETION_PENDING", "PERMANENTLY_DELETED"]) {
      const t = await makeUser();
      const set = { accountState: state, accountStateChangedAt: new Date() };
      if (state === "MUTED") set.accountRestriction = { kind: "TEMPORARY", expiresAt: future() };
      if (state === "HARD_SUSPENDED") set.accountRestriction = { kind: "INDEFINITE" };
      await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(t.id) }, { $set: set });
      await assert.rejects(() => muteAccount(admin.actor, t.id, { expiresAt: future() }), { code: DomainErrorCode.INVALID_STATE }, state);
      assert.equal((await eventsFor(t.id)).length, 0);
    }
  });

  it("concurrent mutes of the same account: exactly one wins, one event, version 1", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => muteAccount(admin.actor, target.id, { expiresAt: future() })));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      assert.ok([DomainErrorCode.STATE_RACE, DomainErrorCode.INVALID_STATE].includes(r.reason.code), r.reason.code);
    }
    assert.equal((await eventsFor(target.id, "MUTE")).length, 1);
    assert.equal((await User.findById(target.id)).accountStateVersion, 1);
  });

  it("a legacy account missing the stored governance fields can be muted (no backfill dependency)", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(target.id) }, { $unset: { accountState: "", accountStateVersion: "" } });
    await muteAccount(admin.actor, target.id, { expiresAt: future() });
    const raw = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(target.id) });
    assert.equal(raw.accountState, "MUTED");
    assert.equal(raw.accountStateVersion, 1);
  });

  it("liftMute (ADMIN): MUTED -> ACTIVE, restriction cleared, version bumped, MUTE_LIFTED event with the admin actor", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await muteAccount(admin.actor, target.id, { expiresAt: future() });
    const res = await liftMute(admin.actor, target.id, { reason: "resolved" });
    const raw = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(target.id) });
    assert.equal(raw.accountState, "ACTIVE");
    assert.equal("accountRestriction" in raw, false);
    assert.equal(raw.accountStateVersion, 2);
    const [lift] = await eventsFor(target.id, "MUTE_LIFTED");
    assert.equal(lift.actorType, "USER");
    assert.equal(String(lift.actor), admin.id);
    assert.equal(lift.previousState, "MUTED");
    assert.equal(lift.resultingState, "ACTIVE");
    assert.equal(lift.idempotencyKey, `MUTE_LIFTED:${target.id}:2`);
    assert.equal(res.eventId, String(lift._id));

    await assert.rejects(() => liftMute(admin.actor, target.id), { code: DomainErrorCode.INVALID_STATE });
    const user = await makeUser();
    await assert.rejects(() => liftMute(user.actor, target.id), { code: DomainErrorCode.FORBIDDEN });
  });

  it("mute -> lift -> mute yields three distinct events (keys derive from the version)", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await muteAccount(admin.actor, target.id, { expiresAt: future() });
    await liftMute(admin.actor, target.id);
    await muteAccount(admin.actor, target.id, { expiresAt: future() });
    const keys = (await eventsFor(target.id)).map((e) => e.idempotencyKey).sort();
    assert.deepEqual(keys, [`MUTE:${target.id}:1`, `MUTE:${target.id}:3`, `MUTE_LIFTED:${target.id}:2`].sort());
  });
});

describe("MUTE expiry (server-side)", () => {
  async function mutedWithExpiry(msFromNow) {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const expiresAt = new Date(Date.now() + msFromNow);
    // The mute must have STARTED before it expires (validated by the service).
    const start = new Date(Math.min(Date.now(), expiresAt.getTime()) - HOUR);
    await muteAccount(admin.actor, target.id, { expiresAt }, { now: start });
    return { admin, target, expiresAt };
  }

  it("expireMuteIfDue: not yet due is a no-op", async () => {
    const { target } = await mutedWithExpiry(HOUR);
    assert.deepEqual(await expireMuteIfDue(target.id), { lifted: false });
    assert.equal((await User.findById(target.id)).accountState, "MUTED");
  });

  it("expireMuteIfDue: due -> ACTIVE with a SYSTEM MUTE_LIFTED event stamped at the expiry time; idempotent", async () => {
    const { target, expiresAt } = await mutedWithExpiry(-HOUR);
    assert.deepEqual(await expireMuteIfDue(target.id), { lifted: true });
    assert.deepEqual(await expireMuteIfDue(target.id), { lifted: false });
    const raw = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(target.id) });
    assert.equal(raw.accountState, "ACTIVE");
    assert.equal("accountRestriction" in raw, false);
    assert.equal(raw.accountStateVersion, 2);
    const lifts = await eventsFor(target.id, "MUTE_LIFTED");
    assert.equal(lifts.length, 1);
    assert.equal(lifts[0].actorType, "SYSTEM");
    assert.equal("actor" in lifts[0], false);
    assert.deepEqual(lifts[0].occurredAt, expiresAt);
  });

  it("concurrent expiry persistence and an admin lift race: one transition, one MUTE_LIFTED event", async () => {
    const { admin, target } = await mutedWithExpiry(-HOUR);
    await Promise.allSettled([
      ...Array.from({ length: 6 }, () => expireMuteIfDue(target.id)),
      liftMute(admin.actor, target.id),
    ]);
    assert.equal((await eventsFor(target.id, "MUTE_LIFTED")).length, 1);
    assert.equal((await User.findById(target.id)).accountState, "ACTIVE");
    assert.equal((await User.findById(target.id)).accountStateVersion, 2);
  });

  it("liftExpiredMutes sweeps only due mutes and honors the limit", async () => {
    const due = await Promise.all([mutedWithExpiry(-HOUR), mutedWithExpiry(-2 * HOUR), mutedWithExpiry(-3 * HOUR)]);
    const notDue = await mutedWithExpiry(HOUR);
    const first = await liftExpiredMutes({ limit: 2 });
    assert.deepEqual(first, { examined: 2, lifted: 2 });
    const second = await liftExpiredMutes();
    assert.deepEqual(second, { examined: 1, lifted: 1 });
    for (const d of due) assert.equal((await User.findById(d.target.id)).accountState, "ACTIVE");
    assert.equal((await User.findById(notDue.target.id)).accountState, "MUTED");
  });
});

describe("MUTE enforcement over HTTP (real app, every existing write surface)", () => {
  async function mutedUser() {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await muteAccount(admin.actor, target.id, { expiresAt: future(2) });
    return { admin, target };
  }
  const concrete = (route) => {
    const [method, path] = route.split(" ");
    return [method, path.replace(/:\w+/g, String(oid()))];
  };

  it("every write route rejects a MUTED actor with 403 ACCOUNT_MUTED (and the envelope has no extras)", async () => {
    const { target } = await mutedUser();
    for (const route of WRITE_ROUTES) {
      const [method, path] = concrete(route);
      const res = await call(method, path, { token: target.accessToken, body: {} });
      assert.equal(res.status, 403, route);
      assert.equal(res.json.code, "ACCOUNT_MUTED", route);
      assert.equal(res.json.success, false);
      assert.equal(res.json.data, null);
      assert.deepEqual(Object.keys(res.json).sort(), ["code", "data", "message", "success"], "no restriction details leak");
    }
  });

  it("the guard's route table matches the real application: no write route is unclassified", async () => {
    const app = createApp();
    const stack = app._router.stack;
    const guardIndex = stack.findIndex((l) => l.handle === contributionRestrictionMiddleware);
    assert.ok(guardIndex > 0, "guard is mounted");
    const found = new Set();
    for (const layer of stack.slice(guardIndex + 1)) {
      if (layer.name !== "router") continue;
      const mount = layer.regexp.source
        .replace(/^\^/, "").replace(/\\\/\?\(\?=\\\/\|\$\)$/, "").replace(/\\\//g, "/");
      for (const sub of layer.handle.stack) {
        if (!sub.route) continue;
        for (const method of Object.keys(sub.route.methods)) {
          if (method === "get" || method === "head" || method === "options") continue;
          found.add(`${method.toUpperCase()} ${mount}${sub.route.path}`);
        }
      }
    }
    assert.deepEqual([...found].sort(), [...WRITE_ROUTES].sort());
    assert.equal(NON_CONTRIBUTION_WRITE_ALLOWLIST.length, 0, "no per-feature exceptions exist");
  });

  it("fail-closed for FUTURE endpoints: any new write method is blocked by default; reads and ACTIVE users are not", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(authMiddleware);
    app.use(accountStateMiddleware);
    app.use(contributionRestrictionMiddleware);
    for (const m of ["get", "post", "put", "patch", "delete"]) app[m]("/api/v1/future-feature", (req, res) => res.json({ ok: true }));
    const s = http.createServer(app);
    await new Promise((r) => s.listen(0, r));
    const base = `http://127.0.0.1:${s.address().port}`;
    try {
      const { target } = await mutedUser();
      const active = await makeUser();
      for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await request(base, m, "/api/v1/future-feature", { token: target.accessToken, body: {} });
        assert.equal(res.status, 403, m);
        assert.equal(res.json.code, "ACCOUNT_MUTED");
        assert.equal((await request(base, m, "/api/v1/future-feature", { token: active.accessToken, body: {} })).status, 200, `${m} active`);
      }
      assert.equal((await request(base, "GET", "/api/v1/future-feature", { token: target.accessToken })).status, 200);
    } finally {
      await new Promise((r) => s.close(r));
    }
  });

  it("a MUTED user can authenticate and read: public reads, /auth/me, refresh and logout all work", async () => {
    const { target } = await mutedUser();
    for (const path of ["/api/v1/issues", "/api/v1/knowledge", "/api/v1/discussions", "/api/v1/community/activity"]) {
      const res = await call("GET", path, { token: target.accessToken });
      assert.equal(res.status, 200, path);
    }
    const me = await call("GET", "/api/v1/auth/me", { token: target.accessToken });
    assert.equal(me.status, 200);
    const refreshed = await call("POST", "/api/v1/auth/refresh", { cookies: { refresh_token: target.refreshToken } });
    assert.equal(refreshed.status, 200, "refresh is not blocked by MUTE");
    const loggedOut = await call("POST", "/api/v1/auth/logout", { token: target.accessToken });
    assert.equal(loggedOut.status, 200);
  });

  it("MUTE does not invalidate the session: the same access token keeps working after the mute", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    assert.equal((await call("GET", "/api/v1/auth/me", { token: target.accessToken })).status, 200);
    await muteAccount(admin.actor, target.id, { expiresAt: future() });
    assert.equal((await call("GET", "/api/v1/auth/me", { token: target.accessToken })).status, 200);
    assert.equal(await Session.countDocuments({ userId: target.id }), 1);
  });

  it("control: an ACTIVE user's contribution is NOT blocked by the guard (reaches validation)", async () => {
    const active = await makeUser();
    const res = await call("POST", "/api/v1/comments", { token: active.accessToken, body: {} });
    assert.notEqual(res.json?.code, "ACCOUNT_MUTED");
    assert.equal(res.status, 400);
  });

  it("anonymous requests are unaffected by the guard (still 401 from the routes)", async () => {
    const res = await call("POST", "/api/v1/comments", { body: {} });
    assert.notEqual(res.json?.code, "ACCOUNT_MUTED");
  });

  it("a muted ADMIN is blocked from governance writes too (mute is always temporary, so this self-heals)", async () => {
    const admin = await makeUser("ADMIN");
    const other = await makeUser("ADMIN");
    // ADR-0012 (#255): an Admin cannot mute a peer through the product, so the
    // Operator-imposed state this test needs is written directly.
    await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(other.id) },
      { $set: { accountState: "MUTED", accountStateChangedAt: new Date(), accountRestriction: { kind: "TEMPORARY", expiresAt: future() } } },
    );
    const res = await call("POST", `/api/v1/accounts/${admin.id}/mute`, { token: other.accessToken, body: { expiresAt: future().toISOString() } });
    assert.equal(res.json.code, "ACCOUNT_MUTED");
  });

  it("HARD_SUSPENDED still reports ACCOUNT_SUSPENDED (precedence unchanged)", async () => {
    const t = await makeUser();
    await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(t.id) },
      { $set: { accountState: "HARD_SUSPENDED", accountStateChangedAt: new Date(), accountRestriction: { kind: "INDEFINITE" } } },
    );
    const res = await call("POST", "/api/v1/comments", { token: t.accessToken, body: {} });
    assert.equal(res.json.code, "ACCOUNT_SUSPENDED");
  });

  it("a MUTED record with no valid restriction cannot expire: it stays blocked (fail closed)", async () => {
    const t = await makeUser();
    await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(t.id) },
      { $set: { accountState: "MUTED", accountStateChangedAt: new Date() } },
    );
    const res = await call("POST", "/api/v1/comments", { token: t.accessToken, body: {} });
    assert.equal(res.json.code, "ACCOUNT_MUTED");
  });

  it("an EXPIRED mute no longer blocks contribution, and the lift is persisted once with a SYSTEM event", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await muteAccount(admin.actor, target.id, { expiresAt: new Date(Date.now() - HOUR) }, { now: new Date(Date.now() - 3 * HOUR) });
    const res = await call("POST", "/api/v1/comments", { token: target.accessToken, body: {} });
    assert.notEqual(res.json?.code, "ACCOUNT_MUTED");
    assert.equal(res.status, 400, "reached validation, i.e. the guard let it through");
    const raw = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(target.id) });
    assert.equal(raw.accountState, "ACTIVE");
    assert.equal(raw.accountStateVersion, 2);
    const lifts = await eventsFor(target.id, "MUTE_LIFTED");
    assert.equal(lifts.length, 1);
    assert.equal(lifts[0].actorType, "SYSTEM");
  });

  it("concurrent requests from a user whose mute just expired: none blocked, exactly one lift event", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await muteAccount(admin.actor, target.id, { expiresAt: new Date(Date.now() - HOUR) }, { now: new Date(Date.now() - 3 * HOUR) });
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => call("POST", "/api/v1/comments", { token: target.accessToken, body: {} })),
    );
    for (const r of responses) assert.notEqual(r.json?.code, "ACCOUNT_MUTED");
    assert.equal((await eventsFor(target.id, "MUTE_LIFTED")).length, 1);
  });

  it("an unexpired mute (expiry in the future) is still enforced until it passes", async () => {
    const { target } = await mutedUser();
    const res = await call("POST", "/api/v1/comments", { token: target.accessToken, body: {} });
    assert.equal(res.json.code, "ACCOUNT_MUTED");
    assert.equal((await User.findById(target.id)).accountState, "MUTED");
    assert.equal((await eventsFor(target.id, "MUTE_LIFTED")).length, 0);
  });
});

describe("Admin MUTE routes (HTTP contract)", () => {
  it("requires authentication (401) and ADMIN (403)", async () => {
    const target = await makeUser();
    const user = await makeUser();
    const body = { expiresAt: future().toISOString() };
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/mute`, { body })).status, 401);
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/mute`, { token: user.accessToken, body })).status, 403);
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/mute/lift`, { token: user.accessToken, body: {} })).status, 403);
  });

  it("validates ids and strict bodies (400)", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const t = admin.accessToken;
    assert.equal((await call("POST", "/api/v1/accounts/not-an-id/mute", { token: t, body: { expiresAt: future().toISOString() } })).status, 400);
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/mute`, { token: t, body: {} })).status, 400);
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/mute`, { token: t, body: { expiresAt: "tomorrow" } })).status, 400);
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/mute`, { token: t, body: { expiresAt: future().toISOString(), accountState: "ACTIVE" } })).status, 400);
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/mute`, { token: t, body: { expiresAt: new Date(Date.now() - HOUR).toISOString() } })).status, 400);
  });

  it("mute then lift end to end: DTO shape, no private reason, enforcement starts and stops", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const expiresAt = future(2).toISOString();
    const res = await call("POST", `/api/v1/accounts/${target.id}/mute`, {
      token: admin.accessToken,
      body: { expiresAt, reason: "PRIVATE-NOTE", safeReason: "Please review the guidelines." },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.accountState, "MUTED");
    assert.equal(res.json.data.restriction.kind, "TEMPORARY");
    assert.equal(res.json.data.restriction.expiresAt, expiresAt);
    assert.equal(res.json.data.restriction.safeReason, "Please review the guidelines.");
    assert.equal(res.text.includes("PRIVATE-NOTE"), false, "private reason is never returned");
    assert.ok(res.json.data.eventId);

    assert.equal((await call("POST", "/api/v1/comments", { token: target.accessToken, body: {} })).json.code, "ACCOUNT_MUTED");

    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/mute`, { token: admin.accessToken, body: { expiresAt } })).status, 409, "already muted");
    const lift = await call("POST", `/api/v1/accounts/${target.id}/mute/lift`, { token: admin.accessToken, body: { reason: "ok" } });
    assert.equal(lift.status, 200);
    assert.equal(lift.json.data.accountState, "ACTIVE");
    assert.equal(lift.json.data.restriction, null);
    assert.equal((await call("POST", "/api/v1/comments", { token: target.accessToken, body: {} })).status, 400, "no longer muted");
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/mute/lift`, { token: admin.accessToken, body: {} })).status, 409, "not muted");
    assert.equal((await call("POST", `/api/v1/accounts/${oid()}/mute`, { token: admin.accessToken, body: { expiresAt } })).status, 404);
  });
});
