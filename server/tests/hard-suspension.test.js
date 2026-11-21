import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";
import jsonwebtoken from "jsonwebtoken";

import { createApp } from "../src/app.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { GovernanceEvent } from "../src/models/GovernanceEvent.js";
import { register, login, refresh } from "../src/services/auth.service.js";
import { signAccessToken, verifyAccessToken } from "../src/services/auth-tokens.js";
import {
  muteAccount,
  suspendAccount,
  liftSuspension,
  liftMute,
  expireSuspensionIfDue,
  liftExpiredSuspensions,
} from "../src/services/account-governance.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { defaultStore } from "../src/middleware/rate-limiter.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * #207 — HARD_SUSPENDED lifecycle and enforcement. Real app, real middleware,
 * real MongoDB. Appeals (#176) and deletion/recovery (#177) are out of scope.
 */

const ALLOWED_ORIGIN = "http://allowed.example.com";
const PASSWORD = "correcthorsebatterystaple";
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
const objectId = (id) => new mongoose.Types.ObjectId(String(id));
let n = 0;

async function makeUser(role = "USER") {
  const email = `susp-${Date.now()}-${n++}@example.test`;
  const { accessToken, refreshToken } = await register({ name: "U", email, password: PASSWORD });
  const user = await User.findOne({ email });
  if (role !== "USER") await User.updateOne({ _id: user._id }, { $set: { role } });
  return { id: String(user._id), actor: { id: user._id, role }, accessToken, refreshToken, email };
}

function call(method, path, { body, token, cookies } = {}) {
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
    const req = http.request(`${baseUrl}${path}`, { method, headers }, (res) => {
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

const future = (h = 2) => new Date(Date.now() + h * HOUR);
const indefinite = (extra = {}) => ({ kind: "INDEFINITE", reason: "PRIVATE-REASON", ...extra });
const eventsFor = (target, action) =>
  GovernanceEvent.collection.find({ target: objectId(target), ...(action ? { action } : {}) }).toArray();
const rawUser = (id) => User.collection.findOne({ _id: objectId(id) });

/** Suspend with a start time in the past so the suspension can already be expired. */
async function suspendedWithExpiry(msFromNow, role = "USER") {
  const admin = await makeUser("ADMIN");
  const target = await makeUser(role);
  const expiresAt = new Date(Date.now() + msFromNow);
  const start = new Date(Math.min(Date.now(), expiresAt.getTime()) - HOUR);
  await suspendAccount(admin.actor, target.id, { kind: "TEMPORARY", expiresAt, reason: "r" }, { now: start });
  return { admin, target, expiresAt };
}

describe("suspendAccount", () => {
  it("TEMPORARY: persists state/version/restriction, invalidates sessions, records one HARD_SUSPEND event", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await login({ email: target.email, password: PASSWORD }); // a second session
    assert.equal(await Session.countDocuments({ userId: target.id }), 2);
    const expiresAt = future();

    const res = await suspendAccount(admin.actor, target.id, {
      kind: "TEMPORARY", expiresAt, reason: "PRIVATE-REASON", safeReason: "Repeated guideline violations.",
    });

    const raw = await rawUser(target.id);
    assert.equal(raw.accountState, "HARD_SUSPENDED");
    assert.equal(raw.accountStateVersion, 1);
    assert.ok(raw.accountStateChangedAt instanceof Date);
    assert.equal(raw.accountRestriction.kind, "TEMPORARY");
    assert.deepEqual(raw.accountRestriction.expiresAt, expiresAt);
    assert.equal(raw.accountRestriction.safeReason, "Repeated guideline violations.");
    assert.equal("reason" in raw.accountRestriction, false, "private reason is never stored on User");
    assert.equal(await Session.countDocuments({ userId: target.id }), 0, "all refresh sessions invalidated");

    const events = await eventsFor(target.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "HARD_SUSPEND");
    assert.equal(events[0].actorType, "USER");
    assert.equal(String(events[0].actor), admin.id);
    assert.equal(events[0].previousState, "ACTIVE");
    assert.equal(events[0].resultingState, "HARD_SUSPENDED");
    assert.equal(events[0].reason, "PRIVATE-REASON");
    assert.equal(events[0].safeReason, "Repeated guideline violations.");
    assert.equal(events[0].idempotencyKey, `HARD_SUSPEND:${target.id}:1`);
    assert.equal(res.eventId, String(events[0]._id));
  });

  it("INDEFINITE: no expiry is stored, and it never expires", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await suspendAccount(admin.actor, target.id, indefinite());
    const raw = await rawUser(target.id);
    assert.equal(raw.accountRestriction.kind, "INDEFINITE");
    assert.equal("expiresAt" in raw.accountRestriction, false);
    assert.deepEqual(await expireSuspensionIfDue(target.id, { now: new Date("2999-01-01") }), { lifted: false });
    assert.equal((await User.findById(target.id)).accountState, "HARD_SUSPENDED");
  });

  it("is ADMIN-only: anonymous, USER and EXPERT are rejected and nothing changes", async () => {
    const target = await makeUser();
    const user = await makeUser();
    const expert = await makeUser("EXPERT");
    await assert.rejects(() => suspendAccount(null, target.id, indefinite()), { code: DomainErrorCode.UNAUTHORIZED });
    await assert.rejects(() => suspendAccount(user.actor, target.id, indefinite()), { code: DomainErrorCode.FORBIDDEN });
    await assert.rejects(() => suspendAccount(expert.actor, target.id, indefinite()), { code: DomainErrorCode.FORBIDDEN });
    assert.equal((await User.findById(target.id)).accountState, "ACTIVE");
    assert.equal((await eventsFor(target.id)).length, 0);
    assert.equal(await Session.countDocuments({ userId: target.id }), 1, "sessions untouched");
  });

  it("validates input before any write: kind, expiry rules, required private reason, bounds", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const bad = [
      {},
      { reason: "r" },
      { kind: "FOREVER", reason: "r" },
      { kind: "TEMPORARY", reason: "r" },
      { kind: "TEMPORARY", reason: "r", expiresAt: "nope" },
      { kind: "TEMPORARY", reason: "r", expiresAt: new Date(Date.now() - HOUR) },
      { kind: "INDEFINITE", reason: "r", expiresAt: future() },
      { kind: "INDEFINITE" },
      { kind: "INDEFINITE", reason: "   " },
      { kind: "INDEFINITE", reason: "x".repeat(2001) },
      { kind: "INDEFINITE", reason: "r", safeReason: "x".repeat(501) },
      { kind: "INDEFINITE", reason: "r", safeReason: " " },
    ];
    for (const input of bad) {
      await assert.rejects(() => suspendAccount(admin.actor, target.id, input), { code: DomainErrorCode.VALIDATION_FAILED }, JSON.stringify(input));
    }
    await assert.rejects(() => suspendAccount(admin.actor, "not-an-id", indefinite()), { code: DomainErrorCode.VALIDATION_FAILED });
    assert.equal((await User.findById(target.id)).accountState, "ACTIVE");
    assert.equal((await eventsFor(target.id)).length, 0);
    assert.equal(await Session.countDocuments({ userId: target.id }), 1);
  });

  describe("transition matrix: only ACTIVE is eligible", () => {
    const SOURCES = {
      MUTED: { accountState: "MUTED", accountRestriction: { kind: "TEMPORARY", expiresAt: future() } },
      HARD_SUSPENDED: { accountState: "HARD_SUSPENDED", accountRestriction: { kind: "INDEFINITE" } },
      DELETION_PENDING: { accountState: "DELETION_PENDING" },
      PERMANENTLY_DELETED: { accountState: "PERMANENTLY_DELETED" },
    };
    for (const [state, set] of Object.entries(SOURCES)) {
      it(`${state} -> HARD_SUSPENDED is rejected (INVALID_STATE), with no event and sessions intact`, async () => {
        const admin = await makeUser("ADMIN");
        const target = await makeUser();
        await User.collection.updateOne({ _id: objectId(target.id) }, { $set: { ...set, accountStateChangedAt: new Date() } });
        const before = await rawUser(target.id);
        await assert.rejects(() => suspendAccount(admin.actor, target.id, indefinite()), { code: DomainErrorCode.INVALID_STATE });
        assert.deepEqual(await rawUser(target.id), before, "target untouched");
        assert.equal((await eventsFor(target.id)).length, 0);
        assert.equal(await Session.countDocuments({ userId: target.id }), 1);
      });
    }
    it("unknown target is NOT_FOUND", async () => {
      const admin = await makeUser("ADMIN");
      await assert.rejects(() => suspendAccount(admin.actor, String(oid()), indefinite()), { code: DomainErrorCode.NOT_FOUND });
    });
  });

  it("a legacy account missing the stored governance fields can be suspended (no backfill dependency)", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await User.collection.updateOne({ _id: objectId(target.id) }, { $unset: { accountState: "", accountStateVersion: "" } });
    await suspendAccount(admin.actor, target.id, indefinite());
    const raw = await rawUser(target.id);
    assert.equal(raw.accountState, "HARD_SUSPENDED");
    assert.equal(raw.accountStateVersion, 1);
  });

  it("concurrent suspends: exactly one wins, one event, version +1", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => suspendAccount(admin.actor, target.id, indefinite())));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      assert.ok([DomainErrorCode.STATE_RACE, DomainErrorCode.INVALID_STATE].includes(r.reason.code), r.reason.code);
    }
    assert.equal((await eventsFor(target.id, "HARD_SUSPEND")).length, 1);
    assert.equal((await User.findById(target.id)).accountStateVersion, 1);
  });

  it("concurrent mute and suspend of the same ACTIVE account: exactly one transition wins", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const results = await Promise.allSettled([
      muteAccount(admin.actor, target.id, { expiresAt: future() }),
      suspendAccount(admin.actor, target.id, indefinite()),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const state = (await User.findById(target.id)).accountState;
    assert.ok(["MUTED", "HARD_SUSPENDED"].includes(state));
    assert.equal((await eventsFor(target.id)).length, 1);
  });

  it("when the audit write fails after the state change: state stays committed, the error surfaces, no false event exists", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    // Force a deterministic audit failure: the key the transition will use is already taken by a DIFFERENT event.
    await GovernanceEvent.create({
      idempotencyKey: `HARD_SUSPEND:${target.id}:1`, action: "MUTE", actorType: "USER", actor: admin.actor.id,
      target: oid(), previousState: "ACTIVE", resultingState: "MUTED",
    });
    await assert.rejects(
      () => suspendAccount(admin.actor, target.id, indefinite()),
      (err) => err.details?.reason === "IDEMPOTENCY_KEY_CONFLICT",
    );
    assert.equal((await User.findById(target.id)).accountState, "HARD_SUSPENDED", "state change is not rolled back (see #204)");
    assert.equal((await eventsFor(target.id, "HARD_SUSPEND")).length, 0, "never a false event");
    assert.equal(await Session.countDocuments({ userId: target.id }), 0, "session invalidation still happened");
  });
});

describe("liftSuspension", () => {
  it("HARD_SUSPENDED -> ACTIVE: restriction cleared, version bumped, SUSPENSION_LIFTED event with the admin actor", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await suspendAccount(admin.actor, target.id, indefinite());
    const res = await liftSuspension(admin.actor, target.id, { reason: "resolved" });
    const raw = await rawUser(target.id);
    assert.equal(raw.accountState, "ACTIVE");
    assert.equal("accountRestriction" in raw, false);
    assert.equal(raw.accountStateVersion, 2);
    const [lift] = await eventsFor(target.id, "SUSPENSION_LIFTED");
    assert.equal(lift.actorType, "USER");
    assert.equal(String(lift.actor), admin.id);
    assert.equal(lift.previousState, "HARD_SUSPENDED");
    assert.equal(lift.resultingState, "ACTIVE");
    assert.equal(lift.idempotencyKey, `SUSPENSION_LIFTED:${target.id}:2`);
    assert.equal(res.eventId, String(lift._id));
  });

  it("is ADMIN-only", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await suspendAccount(admin.actor, target.id, indefinite());
    const user = await makeUser();
    await assert.rejects(() => liftSuspension(null, target.id), { code: DomainErrorCode.UNAUTHORIZED });
    await assert.rejects(() => liftSuspension(user.actor, target.id), { code: DomainErrorCode.FORBIDDEN });
    assert.equal((await User.findById(target.id)).accountState, "HARD_SUSPENDED");
  });

  for (const [state, set] of Object.entries({
    ACTIVE: {},
    MUTED: { accountState: "MUTED", accountRestriction: { kind: "TEMPORARY", expiresAt: future() } },
    DELETION_PENDING: { accountState: "DELETION_PENDING" },
    PERMANENTLY_DELETED: { accountState: "PERMANENTLY_DELETED" },
  })) {
    it(`lifting a suspension on a ${state} account is INVALID_STATE (no event, no change)`, async () => {
      const admin = await makeUser("ADMIN");
      const target = await makeUser();
      if (state !== "ACTIVE") await User.collection.updateOne({ _id: objectId(target.id) }, { $set: { ...set, accountStateChangedAt: new Date() } });
      const before = await rawUser(target.id);
      await assert.rejects(() => liftSuspension(admin.actor, target.id), { code: DomainErrorCode.INVALID_STATE });
      assert.deepEqual(await rawUser(target.id), before);
      assert.equal((await eventsFor(target.id)).length, 0);
    });
  }

  it("lift and mute-lift are not interchangeable: liftMute on a suspended account is INVALID_STATE", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await suspendAccount(admin.actor, target.id, indefinite());
    await assert.rejects(() => liftMute(admin.actor, target.id), { code: DomainErrorCode.INVALID_STATE });
  });

  it("requires a FRESH session: old refresh token is dead, a new login works", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await suspendAccount(admin.actor, target.id, indefinite());
    await liftSuspension(admin.actor, target.id);
    await assert.rejects(() => refresh(target.refreshToken), { code: DomainErrorCode.REFRESH_FAILED });
    const fresh = await login({ email: target.email, password: PASSWORD });
    assert.ok(fresh.accessToken);
    assert.equal(await Session.countDocuments({ userId: target.id }), 1);
  });

  it("a residual session (e.g. created by a racing refresh) is removed BEFORE restoration and cannot be resurrected", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await suspendAccount(admin.actor, target.id, indefinite());
    await Session.collection.insertOne({
      userId: objectId(target.id), tokenHash: "x".repeat(64), expiresAt: new Date(Date.now() + HOUR), createdAt: new Date(),
    });
    assert.equal(await Session.countDocuments({ userId: target.id }), 1);
    await liftSuspension(admin.actor, target.id);
    assert.equal(await Session.countDocuments({ userId: target.id }), 0);
  });
});

describe("suspension expiry (server-side)", () => {
  it("expireSuspensionIfDue: not due is a no-op; due -> ACTIVE with a SYSTEM event stamped at expiry; idempotent", async () => {
    const notDue = await suspendedWithExpiry(HOUR);
    assert.deepEqual(await expireSuspensionIfDue(notDue.target.id), { lifted: false });
    assert.equal((await User.findById(notDue.target.id)).accountState, "HARD_SUSPENDED");

    const { target, expiresAt } = await suspendedWithExpiry(-HOUR);
    assert.deepEqual(await expireSuspensionIfDue(target.id), { lifted: true });
    assert.deepEqual(await expireSuspensionIfDue(target.id), { lifted: false });
    const raw = await rawUser(target.id);
    assert.equal(raw.accountState, "ACTIVE");
    assert.equal("accountRestriction" in raw, false);
    assert.equal(raw.accountStateVersion, 2);
    const lifts = await eventsFor(target.id, "SUSPENSION_LIFTED");
    assert.equal(lifts.length, 1);
    assert.equal(lifts[0].actorType, "SYSTEM");
    assert.equal("actor" in lifts[0], false);
    assert.deepEqual(lifts[0].occurredAt, expiresAt);
  });

  it("concurrent expiry persistence and an admin lift: one transition, one SUSPENSION_LIFTED event", async () => {
    const { admin, target } = await suspendedWithExpiry(-HOUR);
    await Promise.allSettled([
      ...Array.from({ length: 6 }, () => expireSuspensionIfDue(target.id)),
      liftSuspension(admin.actor, target.id),
    ]);
    assert.equal((await eventsFor(target.id, "SUSPENSION_LIFTED")).length, 1);
    assert.equal((await User.findById(target.id)).accountStateVersion, 2);
  });

  it("liftExpiredSuspensions sweeps only due TEMPORARY suspensions; INDEFINITE and not-due are untouched; limit honored", async () => {
    const due = await Promise.all([suspendedWithExpiry(-HOUR), suspendedWithExpiry(-2 * HOUR), suspendedWithExpiry(-3 * HOUR)]);
    const notDue = await suspendedWithExpiry(HOUR);
    const admin = await makeUser("ADMIN");
    const forever = await makeUser();
    await suspendAccount(admin.actor, forever.id, indefinite());
    assert.deepEqual(await liftExpiredSuspensions({ limit: 2 }), { examined: 2, lifted: 2 });
    assert.deepEqual(await liftExpiredSuspensions(), { examined: 1, lifted: 1 });
    for (const d of due) assert.equal((await User.findById(d.target.id)).accountState, "ACTIVE");
    assert.equal((await User.findById(notDue.target.id)).accountState, "HARD_SUSPENDED");
    assert.equal((await User.findById(forever.id)).accountState, "HARD_SUSPENDED");
  });

  it("a mute sweep never touches a suspension and vice versa (restriction families are isolated)", async () => {
    const { target } = await suspendedWithExpiry(-HOUR);
    const { liftExpiredMutes } = await import("../src/services/account-governance.service.js");
    assert.deepEqual(await liftExpiredMutes(), { examined: 0, lifted: 0 });
    assert.equal((await User.findById(target.id)).accountState, "HARD_SUSPENDED");
  });
});

describe("enforcement over HTTP", () => {
  async function suspendedUser(spec = indefinite()) {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await suspendAccount(admin.actor, target.id, spec);
    return { admin, target };
  }

  it("stale access token: a pre-suspension JWT is refused with ACCOUNT_SUSPENDED on reads and writes alike", async () => {
    const { target } = await suspendedUser();
    for (const [method, path] of [["GET", "/api/v1/issues"], ["GET", "/api/v1/dashboard"], ["POST", "/api/v1/comments"], ["POST", "/api/v1/issues"]]) {
      const res = await call(method, path, { token: target.accessToken, body: method === "POST" ? {} : undefined });
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(res.json.code, "ACCOUNT_SUSPENDED", `${method} ${path}`);
    }
  });

  it("/auth/me stays reachable by design (#173) so the client can route to a suspension surface, and exposes only the state", async () => {
    const { target } = await suspendedUser({ kind: "TEMPORARY", expiresAt: future(), reason: "PRIVATE-REASON", safeReason: "SAFE-REASON" });
    const me = await call("GET", "/api/v1/auth/me", { token: target.accessToken });
    assert.equal(me.status, 200);
    assert.equal(me.json.data.accountState, "HARD_SUSPENDED");
    assert.deepEqual(Object.keys(me.json.data).sort(), ["accountState", "user"]);
    for (const secret of ["PRIVATE-REASON", "SAFE-REASON", "expiresAt", "restriction"]) assert.equal(me.text.includes(secret), false, secret);
  });

  it("anonymous public browsing remains available", async () => {
    await suspendedUser();
    for (const path of ["/api/v1/issues", "/api/v1/knowledge", "/api/v1/discussions", "/api/v1/community/activity"]) {
      assert.equal((await call("GET", path)).status, 200, path);
    }
  });

  it("stale refresh token cannot mint a session; login is refused; both use the stable ACCOUNT_SUSPENDED/401 contracts", async () => {
    const { target } = await suspendedUser();
    const refreshed = await call("POST", "/api/v1/auth/refresh", { cookies: { refresh_token: target.refreshToken } });
    assert.ok([401, 403].includes(refreshed.status), String(refreshed.status));
    assert.equal(await Session.countDocuments({ userId: target.id }), 0, "no session was created");
    const loggedIn = await call("POST", "/api/v1/auth/login", { body: { email: target.email, password: PASSWORD } });
    assert.equal(loggedIn.status, 403);
    assert.equal(loggedIn.json.code, "ACCOUNT_SUSPENDED");
    assert.equal(await Session.countDocuments({ userId: target.id }), 0);
  });

  it("privacy: the ACCOUNT_SUSPENDED envelope carries only code and message (no reasons, no expiry, no restriction)", async () => {
    const { target } = await suspendedUser({ kind: "TEMPORARY", expiresAt: future(), reason: "PRIVATE-REASON", safeReason: "SAFE-REASON" });
    const res = await call("GET", "/api/v1/issues", { token: target.accessToken });
    assert.deepEqual(Object.keys(res.json).sort(), ["code", "data", "message", "success"]);
    for (const secret of ["PRIVATE-REASON", "SAFE-REASON", "expiresAt", "restriction"]) assert.equal(res.text.includes(secret), false, secret);
    const login = await call("POST", "/api/v1/auth/login", { body: { email: target.email, password: PASSWORD } });
    for (const secret of ["PRIVATE-REASON", "SAFE-REASON"]) assert.equal(login.text.includes(secret), false, secret);
  });

  it("INVARIANT: an access token issued before the suspension stays invalid after an Admin lift; a fresh login works", async () => {
    const { admin, target } = await suspendedUser();
    // 1-3. issued before suspension; blocked while suspended; refresh session gone
    assert.equal((await call("GET", "/api/v1/dashboard", { token: target.accessToken })).json.code, "ACCOUNT_SUSPENDED");
    assert.equal(await Session.countDocuments({ userId: target.id }), 0);
    await assert.rejects(() => refresh(target.refreshToken));

    // 4. Admin lift does not resurrect it (on authenticated routes, reads and writes, and /auth/me)
    await liftSuspension(admin.actor, target.id);
    assert.equal((await rawUser(target.id)).accountState, "ACTIVE");
    assert.equal((await rawUser(target.id)).authGeneration, 1);
    // (the governance route authenticates before validating, so a write is observable here)
    for (const [method, path] of [["GET", "/api/v1/dashboard"], ["POST", `/api/v1/accounts/${oid()}/mute`]]) {
      const res = await call(method, path, { token: target.accessToken, body: method === "POST" ? {} : undefined });
      assert.equal(res.status, 401, `${method} ${path}: old token must be unauthenticated`);
    }
    const staleMe = await call("GET", "/api/v1/auth/me", { token: target.accessToken });
    assert.equal(staleMe.json.data.user, null, "/auth/me reports no actor for the old token");
    await assert.rejects(() => refresh(target.refreshToken), { code: DomainErrorCode.REFRESH_FAILED });

    // 6. a fresh login yields a usable token
    const fresh = await login({ email: target.email, password: PASSWORD });
    assert.equal((await call("GET", "/api/v1/dashboard", { token: fresh.accessToken })).status, 200);
    assert.notEqual((await call("GET", "/api/v1/auth/me", { token: fresh.accessToken })).json.data.user, null);
    // ...and the pre-suspension token is STILL invalid next to it
    assert.equal((await call("GET", "/api/v1/dashboard", { token: target.accessToken })).status, 401);
  });

  it("INVARIANT: expiry does not resurrect a pre-suspension access token either (request path)", async () => {
    const { target } = await suspendedWithExpiry(-HOUR);
    // The request carrying the pre-suspension token is the one that discovers the expiry.
    const res = await call("GET", "/api/v1/dashboard", { token: target.accessToken });
    assert.equal(res.status, 401, "expired suspension must not promote the old token to ACTIVE");
    const raw = await rawUser(target.id);
    assert.equal(raw.accountState, "ACTIVE", "the lift itself is persisted");
    assert.equal(raw.authGeneration, 1);
    assert.equal((await eventsFor(target.id, "SUSPENSION_LIFTED")).length, 1);
    assert.equal((await call("GET", "/api/v1/dashboard", { token: target.accessToken })).status, 401, "still invalid on the next request");

    const fresh = await login({ email: target.email, password: PASSWORD });
    assert.equal((await call("GET", "/api/v1/dashboard", { token: fresh.accessToken })).status, 200);
  });

  it("INVARIANT: expiry persisted through login or the sweep does not resurrect the old token", async () => {
    const viaLogin = await suspendedWithExpiry(-HOUR);
    const fresh = await login({ email: viaLogin.target.email, password: PASSWORD });
    assert.equal((await rawUser(viaLogin.target.id)).authGeneration, 1);
    assert.equal((await call("GET", "/api/v1/dashboard", { token: viaLogin.target.accessToken })).status, 401);
    assert.equal((await call("GET", "/api/v1/dashboard", { token: fresh.accessToken })).status, 200);

    const viaSweep = await suspendedWithExpiry(-HOUR);
    await liftExpiredSuspensions();
    assert.equal((await rawUser(viaSweep.target.id)).authGeneration, 1);
    assert.equal((await call("GET", "/api/v1/dashboard", { token: viaSweep.target.accessToken })).status, 401);
  });

  it("race safety: concurrent expiry requests, logins and an Admin lift bump the generation exactly once", async () => {
    const { admin, target } = await suspendedWithExpiry(-HOUR);
    await Promise.allSettled([
      ...Array.from({ length: 5 }, () => call("GET", "/api/v1/dashboard", { token: target.accessToken })),
      ...Array.from({ length: 3 }, () => expireSuspensionIfDue(target.id)),
      liftSuspension(admin.actor, target.id),
    ]);
    const raw = await rawUser(target.id);
    assert.equal(raw.accountState, "ACTIVE");
    assert.equal(raw.authGeneration, 1, "one restoration, one generation bump");
    assert.equal(raw.accountStateVersion, 2);
    assert.equal((await eventsFor(target.id, "SUSPENSION_LIFTED")).length, 1);
    assert.equal((await call("GET", "/api/v1/dashboard", { token: target.accessToken })).status, 401);
  });

  it("repeated suspend/lift cycles: every earlier generation stays invalid, only the current login works", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const tokens = [target.accessToken];
    for (let cycle = 1; cycle <= 2; cycle += 1) {
      await suspendAccount(admin.actor, target.id, indefinite());
      await liftSuspension(admin.actor, target.id);
      assert.equal((await rawUser(target.id)).authGeneration, cycle);
      tokens.push((await login({ email: target.email, password: PASSWORD })).accessToken);
    }
    const statuses = [];
    for (const t of tokens) statuses.push((await call("GET", "/api/v1/dashboard", { token: t })).status);
    assert.deepEqual(statuses, [401, 401, 200]);
  });

  it("a stale token still receives ACCOUNT_SUSPENDED WHILE suspended (the client's route to a suspension surface is unchanged)", async () => {
    const { target } = await suspendedUser();
    assert.equal((await call("GET", "/api/v1/dashboard", { token: target.accessToken })).json.code, "ACCOUNT_SUSPENDED");
    assert.equal((await call("GET", "/api/v1/auth/me", { token: target.accessToken })).json.data.accountState, "HARD_SUSPENDED");
    assert.equal((await rawUser(target.id)).authGeneration, undefined, "generation is bumped at restoration, not at suspension");
  });

  it("an INDEFINITE suspension keeps blocking and never persists an expiry", async () => {
    const { target } = await suspendedUser(indefinite());
    assert.equal((await call("GET", "/api/v1/issues", { token: target.accessToken })).json.code, "ACCOUNT_SUSPENDED");
    assert.equal((await eventsFor(target.id, "SUSPENSION_LIFTED")).length, 0);
  });

  it("an EXPIRED temporary suspension is persisted once with a SYSTEM event; anonymous browsing is unaffected throughout", async () => {
    const { target } = await suspendedWithExpiry(-HOUR);
    const res = await call("GET", "/api/v1/issues", { token: target.accessToken });
    assert.equal(res.status, 200, "public read still works (the old token is simply not an actor)");
    const raw = await rawUser(target.id);
    assert.equal(raw.accountState, "ACTIVE");
    assert.equal(raw.accountStateVersion, 2);
    const lifts = await eventsFor(target.id, "SUSPENSION_LIFTED");
    assert.equal(lifts.length, 1);
    assert.equal(lifts[0].actorType, "SYSTEM");
  });

  it("concurrent requests after expiry: exactly one lift event; none is treated as the suspended actor", async () => {
    const { target } = await suspendedWithExpiry(-HOUR);
    const responses = await Promise.all(Array.from({ length: 8 }, () => call("GET", "/api/v1/dashboard", { token: target.accessToken })));
    for (const r of responses) assert.equal(r.status, 401);
    assert.equal((await eventsFor(target.id, "SUSPENSION_LIFTED")).length, 1);
    assert.equal((await rawUser(target.id)).authGeneration, 1);
  });

  it("login after expiry succeeds (lift persisted at login); before expiry it is refused", async () => {
    const stillSuspended = await suspendedWithExpiry(HOUR);
    assert.equal((await call("POST", "/api/v1/auth/login", { body: { email: stillSuspended.target.email, password: PASSWORD } })).json.code, "ACCOUNT_SUSPENDED");

    const expired = await suspendedWithExpiry(-HOUR);
    const res = await call("POST", "/api/v1/auth/login", { body: { email: expired.target.email, password: PASSWORD } });
    assert.equal(res.status, 200);
    assert.equal((await User.findById(expired.target.id)).accountState, "ACTIVE");
    assert.equal((await eventsFor(expired.target.id, "SUSPENSION_LIFTED")).length, 1);
    assert.equal(await Session.countDocuments({ userId: expired.target.id }), 1, "exactly the fresh session");
  });

  it("a HARD_SUSPENDED record with no valid restriction cannot expire: it stays blocked (fail closed)", async () => {
    const t = await makeUser();
    await User.collection.updateOne({ _id: objectId(t.id) }, { $set: { accountState: "HARD_SUSPENDED", accountStateChangedAt: new Date() } });
    assert.equal((await call("GET", "/api/v1/issues", { token: t.accessToken })).json.code, "ACCOUNT_SUSPENDED");
  });

  it("a suspended Admin cannot call governance routes", async () => {
    const a = await makeUser("ADMIN");
    const b = await makeUser("ADMIN");
    await suspendAccount(a.actor, b.id, indefinite());
    const res = await call("POST", `/api/v1/accounts/${a.id}/suspend`, { token: b.accessToken, body: indefinite() });
    assert.equal(res.json.code, "ACCOUNT_SUSPENDED");
  });

  it("precedence: a suspended account reports ACCOUNT_SUSPENDED, never ACCOUNT_MUTED, even where MUTE would also apply to the write", async () => {
    const { target } = await suspendedUser();
    const res = await call("POST", "/api/v1/comments", { token: target.accessToken, body: {} });
    assert.equal(res.json.code, "ACCOUNT_SUSPENDED");
  });
});

describe("Admin suspension routes (HTTP contract)", () => {
  const T = (extra = {}) => ({ kind: "TEMPORARY", expiresAt: future().toISOString(), reason: "PRIVATE-NOTE", ...extra });

  it("requires authentication (401) and ADMIN (403)", async () => {
    const target = await makeUser();
    const user = await makeUser();
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/suspend`, { body: T() })).status, 401);
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/suspend`, { token: user.accessToken, body: T() })).status, 403);
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/suspend/lift`, { token: user.accessToken, body: {} })).status, 403);
  });

  it("validates ids and strict, explicit-kind bodies (400)", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const t = admin.accessToken;
    const post = (body, id = target.id) => call("POST", `/api/v1/accounts/${id}/suspend`, { token: t, body });
    assert.equal((await post(T(), "not-an-id")).status, 400);
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ reason: "r" })).status, 400, "kind is mandatory: omitting expiry must not yield an indefinite suspension");
    assert.equal((await post({ kind: "TEMPORARY", reason: "r" })).status, 400);
    assert.equal((await post(T({ expiresAt: "tomorrow" }))).status, 400);
    assert.equal((await post(T({ expiresAt: new Date(Date.now() - HOUR).toISOString() }))).status, 400);
    assert.equal((await post({ kind: "INDEFINITE", reason: "r", expiresAt: future().toISOString() })).status, 400);
    assert.equal((await post({ kind: "INDEFINITE" })).status, 400, "private reason is required");
    assert.equal((await post(T({ accountState: "ACTIVE" }))).status, 400, "strict body");
    assert.equal((await post({ ...T(), actor: "x" })).status, 400);
    assert.equal((await User.findById(target.id)).accountState, "ACTIVE");
  });

  it("suspend then lift end to end: DTO shape, no private reason in any response, enforcement starts and stops", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const expiresAt = future().toISOString();
    const res = await call("POST", `/api/v1/accounts/${target.id}/suspend`, {
      token: admin.accessToken,
      body: { kind: "TEMPORARY", expiresAt, reason: "PRIVATE-NOTE", safeReason: "Please review the guidelines." },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.accountState, "HARD_SUSPENDED");
    assert.equal(res.json.data.restriction.kind, "TEMPORARY");
    assert.equal(res.json.data.restriction.expiresAt, expiresAt);
    assert.equal(res.json.data.restriction.safeReason, "Please review the guidelines.");
    assert.equal(res.text.includes("PRIVATE-NOTE"), false);
    assert.ok(res.json.data.eventId);

    assert.equal((await call("GET", "/api/v1/issues", { token: target.accessToken })).json.code, "ACCOUNT_SUSPENDED");
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/suspend`, { token: admin.accessToken, body: T() })).status, 409, "already suspended");

    const lift = await call("POST", `/api/v1/accounts/${target.id}/suspend/lift`, { token: admin.accessToken, body: { reason: "ok" } });
    assert.equal(lift.status, 200);
    assert.equal(lift.json.data.accountState, "ACTIVE");
    assert.equal(lift.json.data.restriction, null);
    assert.equal(lift.text.includes("PRIVATE-NOTE"), false);
    assert.equal((await call("POST", "/api/v1/auth/login", { body: { email: target.email, password: PASSWORD } })).status, 200);
    assert.equal((await call("POST", `/api/v1/accounts/${target.id}/suspend/lift`, { token: admin.accessToken, body: {} })).status, 409, "not suspended");
    assert.equal((await call("POST", `/api/v1/accounts/${oid()}/suspend`, { token: admin.accessToken, body: T() })).status, 404);
  });

  it("INDEFINITE suspension through the API stores no expiry", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const res = await call("POST", `/api/v1/accounts/${target.id}/suspend`, { token: admin.accessToken, body: { kind: "INDEFINITE", reason: "r" } });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.restriction.kind, "INDEFINITE");
    assert.equal(res.json.data.restriction.expiresAt, null);
  });

  it("cross-state: suspending a MUTED account is refused (409); muting a suspended one too", async () => {
    const admin = await makeUser("ADMIN");
    const a = await makeUser();
    const b = await makeUser();
    await muteAccount(admin.actor, a.id, { expiresAt: future() });
    await suspendAccount(admin.actor, b.id, indefinite());
    assert.equal((await call("POST", `/api/v1/accounts/${a.id}/suspend`, { token: admin.accessToken, body: T() })).status, 409);
    assert.equal((await call("POST", `/api/v1/accounts/${b.id}/mute`, { token: admin.accessToken, body: { expiresAt: future().toISOString() } })).status, 409);
  });
});

describe("credential generation (token claim and MUTE isolation)", () => {
  it("claim shape: generation 0 is unchanged in shape; non-zero carries `gen`; a malformed `gen` is rejected; tampering fails", () => {
    const sub = String(oid());
    assert.deepEqual(verifyAccessToken(signAccessToken({ sub })), { sub });
    assert.deepEqual(verifyAccessToken(signAccessToken({ sub, gen: 0 })), { sub });
    assert.deepEqual(verifyAccessToken(signAccessToken({ sub, gen: 3 })), { sub, gen: 3 });
    for (const gen of [-1, 1.5, "1", null]) {
      const forged = jsonwebtoken.sign({ sub, gen }, process.env.JWT_ACCESS_SECRET, { algorithm: "HS256", expiresIn: "5m" });
      assert.throws(() => verifyAccessToken(forged), `gen=${JSON.stringify(gen)}`);
    }
    // An attacker cannot downgrade a token's generation: editing the payload breaks the signature.
    const [h, , sig] = signAccessToken({ sub, gen: 5 }).split(".");
    const edited = `${h}.${Buffer.from(JSON.stringify({ sub, exp: 4102444800 })).toString("base64url")}.${sig}`;
    assert.throws(() => verifyAccessToken(edited));
  });

  it("MUTE (apply, lift, expiry) never changes the credential generation: the same token keeps working", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    await muteAccount(admin.actor, target.id, { expiresAt: future() });
    assert.equal((await call("GET", "/api/v1/dashboard", { token: target.accessToken })).status, 200);
    await liftMute(admin.actor, target.id);
    assert.equal((await call("GET", "/api/v1/dashboard", { token: target.accessToken })).status, 200);
    assert.equal((await rawUser(target.id)).authGeneration, undefined);

    const expired = await makeUser();
    await muteAccount(admin.actor, expired.id, { expiresAt: new Date(Date.now() - HOUR) }, { now: new Date(Date.now() - 3 * HOUR) });
    assert.equal((await call("GET", "/api/v1/dashboard", { token: expired.accessToken })).status, 200, "an expired mute does not demand a new login");
    assert.equal((await rawUser(expired.id)).authGeneration, undefined);
  });

  it("legacy users (no authGeneration stored) and pre-#207 tokens (no gen claim) keep working unchanged", async () => {
    const t = await makeUser();
    assert.equal((await rawUser(t.id)).authGeneration, undefined);
    assert.equal((await call("GET", "/api/v1/dashboard", { token: t.accessToken })).status, 200);
  });

  it("authGeneration is never exposed through the User JSON serialization", async () => {
    const t = await makeUser();
    await User.collection.updateOne({ _id: objectId(t.id) }, { $set: { authGeneration: 4 } });
    assert.equal("authGeneration" in JSON.parse(JSON.stringify(await User.findById(t.id))), false);
  });
});
