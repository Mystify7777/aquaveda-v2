import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { GovernanceEvent } from "../src/models/GovernanceEvent.js";
import { register, login, refresh } from "../src/services/auth.service.js";
import {
  muteAccount,
  liftMute,
  suspendAccount,
  liftSuspension,
  expireMuteIfDue,
  expireSuspensionIfDue,
  liftExpiredSuspensions,
  purgeStaleSessions,
  governanceTestHooks,
} from "../src/services/account-governance.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { defaultStore } from "../src/middleware/rate-limiter.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * #217 / #219 — the restoration / session-cleanup race. Every interleaving is
 * forced with explicit barriers on the service's hook points; there are no
 * timing sleeps. Protocol and guarantees (G1-G6):
 * docs/architecture/hard-suspension.md, "Restoration and session-cleanup protocol".
 */

const ALLOWED_ORIGIN = "http://allowed.example.com";
const PASSWORD = "correcthorsebatterystaple";
const HOUR = 3_600_000;
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
afterEach(() => {
  governanceTestHooks.afterRead = undefined;
  governanceTestHooks.afterFlip = undefined;
  governanceTestHooks.beforeCleanup = undefined;
});

const objectId = (id) => new mongoose.Types.ObjectId(String(id));
let n = 0;

async function makeUser(role = "USER") {
  const email = `race-${Date.now()}-${n++}@example.test`;
  const { accessToken, refreshToken } = await register({ name: "U", email, password: PASSWORD });
  const user = await User.findOne({ email });
  if (role !== "USER") await User.updateOne({ _id: user._id }, { $set: { role } });
  return { id: String(user._id), actor: { id: user._id, role }, accessToken, refreshToken, email };
}

function dashboardStatus(token) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}/api/v1/dashboard`, {
      method: "GET",
      headers: { Origin: ALLOWED_ORIGIN, Cookie: `${ACCESS_TOKEN_COOKIE_NAME}=${token}` },
    }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
    req.end();
  });
}

const sessionCount = (id) => Session.countDocuments({ userId: id });
const rawUser = (id) => User.collection.findOne({ _id: objectId(id) });
const eventsFor = (id, action) =>
  GovernanceEvent.collection.find({ target: objectId(id), ...(action ? { action } : {}) }).toArray();
const indefinite = () => ({ kind: "INDEFINITE", reason: "r" });

function makeGate() {
  let release;
  let arrived;
  const gate = new Promise((r) => { release = r; });
  const reached = new Promise((r) => { arrived = r; });
  return { gate, reached, release, arrived };
}

/**
 * Barriers assigned IN CALL ORDER: the Nth matching hook call parks on the Nth
 * gate until `release()`; `reached` resolves once that caller is parked. Later
 * matching calls pass straight through.
 */
function parkN(hookName, match, count) {
  const gates = Array.from({ length: count }, makeGate);
  let next = 0;
  const prior = governanceTestHooks[hookName];
  governanceTestHooks[hookName] = async (ctx) => {
    if (next < count && match(ctx)) {
      const g = gates[next];
      next += 1;
      g.arrived(ctx);
      await g.gate;
      return;
    }
    if (prior) await prior(ctx);
  };
  return gates.map(({ reached, release }) => ({ reached, release }));
}

const park = (hookName, match) => parkN(hookName, match, 1)[0];
const parkTwo = (hookName, match) => parkN(hookName, match, 2);

/** Hook that throws for matching calls (simulated cleanup failure); counts invocations. */
function failCleanup(match) {
  const calls = [];
  governanceTestHooks.beforeCleanup = async (ctx) => {
    calls.push(ctx);
    if (match(ctx)) throw new Error("simulated cleanup failure");
  };
  return calls;
}

/**
 * An expired TEMPORARY suspension. With `keepSessions` the suspension-time
 * cleanup is made to fail so the account's pre-suspension session (the one
 * `register` created) survives, modelling a crashed/failed cleanup.
 */
async function suspendedExpired({ keepSessions = false } = {}) {
  const admin = await makeUser("ADMIN");
  const target = await makeUser();
  const expiresAt = new Date(Date.now() - HOUR);
  if (keepSessions) failCleanup((ctx) => ctx.phase === "suspend");
  await suspendAccount(admin.actor, target.id, { kind: "TEMPORARY", expiresAt, reason: "r" }, { now: new Date(Date.now() - 2 * HOUR) });
  governanceTestHooks.beforeCleanup = undefined;
  if (keepSessions) assert.equal(await sessionCount(target.id), 1, "setup: pre-suspension session survived");
  return { admin, target };
}

async function assertFreshSessionUsable(target, freshRefreshToken) {
  const rotated = await refresh(freshRefreshToken);
  assert.ok(rotated.accessToken && rotated.refreshToken);
  assert.equal(await dashboardStatus(rotated.accessToken), 200, "the fresh post-restoration credential works end to end");
  return rotated;
}

describe("a stale expiry worker loses to an Admin lift (G1, G2)", () => {
  it("deletes nothing: the fresh post-restoration session survives and works", async () => {
    const { admin, target } = await suspendedExpired();
    const gate = park("afterRead", (c) => c.mode === "expiry" && String(c.targetId) === target.id);
    const stale = expireSuspensionIfDue(target.id);
    await gate.reached; // the stale worker has read "expired HARD_SUSPENDED" and is parked before its write

    await liftSuspension(admin.actor, target.id); // another actor restores
    const fresh = await login({ email: target.email, password: PASSWORD }); // user returns: fresh session
    assert.equal(await sessionCount(target.id), 1);

    gate.release();
    assert.deepEqual(await stale, { lifted: false }, "the stale worker lost");
    assert.equal(await sessionCount(target.id), 1, "the loser deleted no session");

    await assertFreshSessionUsable(target, fresh.refreshToken);
    const raw = await rawUser(target.id);
    assert.equal(raw.accountState, "ACTIVE");
    assert.equal(raw.authGeneration, 1, "exactly one generation bump");
    const lifts = await eventsFor(target.id, "SUSPENSION_LIFTED");
    assert.equal(lifts.length, 1);
    assert.equal(lifts[0].actorType, "USER", "the Admin lift won, not the worker");
  });
});

describe("concurrent expiry workers (G1, G5)", () => {
  it("exactly one wins; the loser, resuming after a fresh login, deletes nothing", async () => {
    const { target } = await suspendedExpired();
    const [a, b] = parkTwo("afterRead", (c) => c.mode === "expiry" && String(c.targetId) === target.id);
    const first = expireSuspensionIfDue(target.id);
    const second = expireSuspensionIfDue(target.id);
    await a.reached;
    await b.reached; // both workers read an expired suspension and are parked

    a.release();
    assert.deepEqual(await first, { lifted: true });
    const fresh = await login({ email: target.email, password: PASSWORD });
    b.release();
    assert.deepEqual(await second, { lifted: false });

    assert.equal(await sessionCount(target.id), 1);
    await assertFreshSessionUsable(target, fresh.refreshToken);
    assert.equal((await rawUser(target.id)).authGeneration, 1);
    assert.equal((await eventsFor(target.id, "SUSPENSION_LIFTED")).length, 1);
  });

  it("the WINNER's own late cleanup cannot delete a session issued after its write (bound to the restored generation)", async () => {
    const { target } = await suspendedExpired({ keepSessions: true });
    const gate = park("afterFlip", (c) => c.phase === "restore" && String(c.targetId) === target.id);
    const winner = expireSuspensionIfDue(target.id);
    await gate.reached; // restored (ACTIVE, gen 1) but cleanup has NOT run yet

    // G3: with cleanup pending, the pre-suspension refresh token is already unusable.
    assert.equal(await sessionCount(target.id), 1, "the stale session is still in the database");
    await assert.rejects(() => refresh(target.refreshToken), { code: DomainErrorCode.REFRESH_FAILED });

    const fresh = await login({ email: target.email, password: PASSWORD });
    gate.release();
    assert.deepEqual(await winner, { lifted: true });

    assert.equal(await sessionCount(target.id), 1, "only the fresh session remains");
    await assertFreshSessionUsable(target, fresh.refreshToken);
  });
});

describe("expiry racing with login (G1)", () => {
  it("a parked expiry worker loses to login's own lazy restoration and deletes nothing", async () => {
    const { target } = await suspendedExpired();
    const gate = park("afterRead", (c) => c.mode === "expiry" && String(c.targetId) === target.id);
    const worker = expireSuspensionIfDue(target.id);
    await gate.reached;

    // login() persists the lazy expiry through the SAME core, and wins.
    const fresh = await login({ email: target.email, password: PASSWORD });
    gate.release();
    assert.deepEqual(await worker, { lifted: false });

    assert.equal(await sessionCount(target.id), 1);
    await assertFreshSessionUsable(target, fresh.refreshToken);
    const lifts = await eventsFor(target.id, "SUSPENSION_LIFTED");
    assert.equal(lifts.length, 1);
    assert.equal(lifts[0].actorType, "SYSTEM");
  });
});

describe("Admin lift racing with expiry (G1)", () => {
  it("a parked Admin lift loses to the expiry worker: STATE_RACE, no cleanup, fresh session intact", async () => {
    const { admin, target } = await suspendedExpired();
    const gate = park("afterRead", (c) => c.mode === "admin" && String(c.targetId) === target.id);
    const adminLift = liftSuspension(admin.actor, target.id);
    const settled = adminLift.then((v) => ({ ok: v }), (e) => ({ err: e }));
    await gate.reached;

    assert.deepEqual(await expireSuspensionIfDue(target.id), { lifted: true });
    const fresh = await login({ email: target.email, password: PASSWORD });
    gate.release();
    const outcome = await settled;
    assert.equal(outcome.err?.code, DomainErrorCode.STATE_RACE);

    assert.equal(await sessionCount(target.id), 1);
    await assertFreshSessionUsable(target, fresh.refreshToken);
    const lifts = await eventsFor(target.id, "SUSPENSION_LIFTED");
    assert.equal(lifts.length, 1);
    assert.equal(lifts[0].actorType, "SYSTEM");
    assert.equal((await rawUser(target.id)).authGeneration, 1);
  });

  it("the sweep follows the same protocol: it examines the account, loses to an Admin lift, deletes nothing", async () => {
    const { admin, target } = await suspendedExpired();
    const gate = park("afterRead", (c) => c.mode === "expiry" && String(c.targetId) === target.id);
    const sweep = liftExpiredSuspensions();
    await gate.reached;
    await liftSuspension(admin.actor, target.id);
    const fresh = await login({ email: target.email, password: PASSWORD });
    gate.release();
    assert.deepEqual(await sweep, { examined: 1, lifted: 0 });
    assert.equal(await sessionCount(target.id), 1);
    await assertFreshSessionUsable(target, fresh.refreshToken);
  });
});

describe("a delayed SUSPENSION-time cleanup cannot delete a later session (G2)", () => {
  it("parked between the suspending write and its cleanup, across a full restore + login", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser();
    const gate = park("afterFlip", (c) => c.phase === "suspend" && String(c.targetId) === target.id);
    const suspending = suspendAccount(admin.actor, target.id, indefinite());
    await gate.reached; // HARD_SUSPENDED is committed; its cleanup has not run

    await liftSuspension(admin.actor, target.id); // restored (gen 1)
    const fresh = await login({ email: target.email, password: PASSWORD });
    gate.release();
    await suspending; // the delayed suspension cleanup runs now, bound to generation 0

    assert.equal(await sessionCount(target.id), 1, "the post-restoration session survived the stale cleanup");
    await assertFreshSessionUsable(target, fresh.refreshToken);
  });
});

describe("cleanup failure and recovery (G3, reconciliation)", () => {
  it("a failed cleanup neither blocks the restoration nor its event, and the stale credential is unusable anyway", async () => {
    const { admin, target } = await suspendedExpired({ keepSessions: true });
    const calls = failCleanup((c) => c.phase === "restore");
    const res = await liftSuspension(admin.actor, target.id); // must not throw
    assert.equal(res.accountState, "ACTIVE");
    assert.equal(calls.filter((c) => c.phase === "restore").length, 1, "cleanup was attempted and failed");
    assert.equal((await eventsFor(target.id, "SUSPENSION_LIFTED")).length, 1, "the event was still recorded");

    // The crash window: ACTIVE, cleanup never ran, the old refresh session is still stored...
    assert.equal(await sessionCount(target.id), 1);
    // ...but unusable.
    await assert.rejects(() => refresh(target.refreshToken), { code: DomainErrorCode.REFRESH_FAILED });
    assert.equal(await dashboardStatus(target.accessToken), 401, "the old access token is dead too");
  });

  it("recovery: purgeStaleSessions is idempotent and never touches a current-generation session", async () => {
    const { admin, target } = await suspendedExpired();
    await liftSuspension(admin.actor, target.id);
    const fresh = await login({ email: target.email, password: PASSWORD });
    await Session.collection.insertOne({ userId: objectId(target.id), tokenHash: "s".repeat(64), expiresAt: new Date(Date.now() + HOUR), createdAt: new Date() });
    assert.equal(await sessionCount(target.id), 2);
    assert.deepEqual(await purgeStaleSessions(target.id), { deleted: 1 });
    assert.deepEqual(await purgeStaleSessions(target.id), { deleted: 0 }, "idempotent");
    assert.equal(await sessionCount(target.id), 1);
    await assertFreshSessionUsable(target, fresh.refreshToken);
  });

  it("recovery: the next login removes stale leftovers from a failed cleanup", async () => {
    const { admin, target } = await suspendedExpired({ keepSessions: true });
    failCleanup((c) => c.phase === "restore");
    await liftSuspension(admin.actor, target.id);
    governanceTestHooks.beforeCleanup = undefined;
    assert.equal(await sessionCount(target.id), 1, "stale leftover");
    const fresh = await login({ email: target.email, password: PASSWORD });
    assert.equal(await sessionCount(target.id), 1, "leftover purged; only the fresh session remains");
    await assertFreshSessionUsable(target, fresh.refreshToken);
  });
});

describe("pre-suspension credentials and fresh sessions", () => {
  it("the pre-suspension refresh token is rejected after every restoration path", async () => {
    for (const restore of ["admin", "expiry", "login"]) {
      const admin = await makeUser("ADMIN");
      const target = await makeUser();
      const expiresAt = new Date(Date.now() + (restore === "admin" ? HOUR : -HOUR));
      const start = new Date(Math.min(Date.now(), expiresAt.getTime()) - HOUR);
      await suspendAccount(admin.actor, target.id, { kind: "TEMPORARY", expiresAt, reason: "r" }, { now: start });
      let fresh;
      if (restore === "admin") await liftSuspension(admin.actor, target.id);
      if (restore === "expiry") await expireSuspensionIfDue(target.id);
      if (restore === "login") fresh = await login({ email: target.email, password: PASSWORD });
      fresh ??= await login({ email: target.email, password: PASSWORD });
      await assert.rejects(() => refresh(target.refreshToken), { code: DomainErrorCode.REFRESH_FAILED }, restore);
      assert.equal(await dashboardStatus(target.accessToken), 401, `${restore}: old access token`);
      await assertFreshSessionUsable(target, fresh.refreshToken);
    }
  });

  it("refresh stays single-use and a session whose stored generation is not the user's current one is rejected", async () => {
    const { admin, target } = await suspendedExpired();
    await liftSuspension(admin.actor, target.id);
    const fresh = await login({ email: target.email, password: PASSWORD });
    const rotated = await refresh(fresh.refreshToken);
    await assert.rejects(() => refresh(fresh.refreshToken), { code: DomainErrorCode.REFRESH_FAILED }, "single-use unchanged");

    await Session.collection.updateMany({ userId: objectId(target.id) }, { $set: { authGeneration: 5 } });
    await assert.rejects(() => refresh(rotated.refreshToken), { code: DomainErrorCode.REFRESH_FAILED }, "strict equality");
  });
});

describe("backwards compatibility", () => {
  it("legacy users and sessions without any generation field refresh normally; generation 0 stores nothing on the session", async () => {
    const t = await makeUser();
    const raw = await Session.collection.findOne({ userId: objectId(t.id) });
    assert.equal("authGeneration" in raw, false);
    assert.equal((await rawUser(t.id)).authGeneration, undefined);
    const rotated = await refresh(t.refreshToken);
    assert.equal(await dashboardStatus(rotated.accessToken), 200);
    const next = await Session.collection.findOne({ userId: objectId(t.id) });
    assert.equal("authGeneration" in next, false);
  });

  it("a session issued after a restoration is stamped with the new generation", async () => {
    const { admin, target } = await suspendedExpired();
    await liftSuspension(admin.actor, target.id);
    await login({ email: target.email, password: PASSWORD });
    const raw = await Session.collection.findOne({ userId: objectId(target.id) });
    assert.equal(raw.authGeneration, 1);
  });
});

describe("MUTE is unchanged (G6)", () => {
  it("apply, lift and expiry never run session cleanup, never touch sessions, never bump the generation", async () => {
    const admin = await makeUser("ADMIN");
    const a = await makeUser();
    const b = await makeUser();
    const calls = failCleanup(() => false); // observes every cleanup attempt
    const sessionIdsBefore = (await Session.find({ userId: { $in: [a.id, b.id] } }).lean()).map((s) => String(s._id)).sort();

    await muteAccount(admin.actor, a.id, { expiresAt: new Date(Date.now() + HOUR) });
    await liftMute(admin.actor, a.id);
    await muteAccount(admin.actor, b.id, { expiresAt: new Date(Date.now() - HOUR) }, { now: new Date(Date.now() - 2 * HOUR) });
    assert.deepEqual(await expireMuteIfDue(b.id), { lifted: true });

    assert.equal(calls.length, 0, "no cleanup was even attempted for MUTE");
    const sessionIdsAfter = (await Session.find({ userId: { $in: [a.id, b.id] } }).lean()).map((s) => String(s._id)).sort();
    assert.deepEqual(sessionIdsAfter, sessionIdsBefore);
    for (const u of [a, b]) assert.equal((await rawUser(u.id)).authGeneration, undefined);
    assert.ok(await refresh(a.refreshToken), "the pre-mute refresh token still works");
    assert.equal(await dashboardStatus(b.accessToken), 200, "an expired mute does not demand a new login");
  });
});
