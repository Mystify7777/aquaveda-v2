import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../src/middleware/auth.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { GovernanceEvent } from "../src/models/GovernanceEvent.js";
import { register } from "../src/services/auth.service.js";
import {
  muteAccount,
  suspendAccount,
  liftMute,
  liftSuspension,
  expireMuteIfDue,
  expireSuspensionIfDue,
  expireAccountRestrictionIfDue,
  governanceTestHooks,
} from "../src/services/account-governance.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { ADMIN_TARGET_REASONS, NOT_ADMIN_FILTER, adminTargetingViolation } from "../src/domain/admin-targeting.js";
import { CLIENT_SAFE_REASONS, isClientSafeReason } from "../src/http/reasons.js";
import { defaultStore } from "../src/middleware/rate-limiter.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * #255: ADR-0012 D2/D3/D8 enforcement on the real service, real Express app and
 * real MongoDB. Races are forced with explicit hook barriers, never sleeps.
 */

const ORIGIN = "http://allowed.example.com";
const PASSWORD = "correcthorsebatterystaple";
const HOUR = 3_600_000;
const SELF = ADMIN_TARGET_REASONS.SELF;
const PEER = ADMIN_TARGET_REASONS.ADMIN;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const future = () => new Date(Date.now() + 2 * HOUR);
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
  Object.assign(governanceTestHooks, { afterRead: undefined, afterTargetRead: undefined, afterFlip: undefined, beforeCleanup: undefined });
});

async function makeUser(role = "USER") {
  const email = `adm-${Date.now()}-${n++}@example.test`;
  const { accessToken } = await register({ name: `U${n}`, email, password: PASSWORD });
  const user = await User.findOne({ email });
  if (role !== "USER") await User.updateOne({ _id: user._id }, { $set: { role } });
  return { id: String(user._id), actor: { id: user._id, role }, accessToken };
}

/** Operator-imposed state (the product can no longer create it for an Admin). */
async function setState(id, state) {
  if (state === "ACTIVE") return;
  const record =
    state === "MUTED"
      ? { accountState: "MUTED", accountRestriction: { kind: "TEMPORARY", expiresAt: future() } }
      : { accountState: "HARD_SUSPENDED", accountRestriction: { kind: "INDEFINITE" } };
  await User.collection.updateOne(
    { _id: oid(id) },
    { $set: { ...record, accountStateChangedAt: new Date(), accountStateVersion: 1 } },
  );
}

const OPS = {
  mute: { run: (a, t) => muteAccount(a.actor, t, { expiresAt: future() }), path: "mute", body: () => ({ expiresAt: future().toISOString() }) },
  liftMute: { run: (a, t) => liftMute(a.actor, t, {}), path: "mute/lift", body: () => ({}) },
  suspend: { run: (a, t) => suspendAccount(a.actor, t, { kind: "INDEFINITE", reason: "r" }), path: "suspend", body: () => ({ kind: "INDEFINITE", reason: "r" }) },
  liftSuspension: { run: (a, t) => liftSuspension(a.actor, t, {}), path: "suspend/lift", body: () => ({}) },
};

function post(path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body ?? {});
    const headers = { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) };
    if (token) headers.Cookie = `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
    const req = http.request(`${baseUrl}${path}`, { method: "POST", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null, text });
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
const http_ = (op, actor, targetId) => post(`/api/v1/accounts/${targetId}/${OPS[op].path}`, actor.accessToken, OPS[op].body());

/** Everything a rejected operation must leave untouched. */
async function snapshot(id) {
  return {
    user: await User.collection.findOne({ _id: oid(id) }),
    sessions: (await Session.find({ userId: id }).select("_id authGeneration").sort({ _id: 1 }).lean()).map((s) => [String(s._id), s.authGeneration ?? 0]),
    events: await GovernanceEvent.countDocuments({ target: id }),
    allEvents: await GovernanceEvent.countDocuments(),
  };
}

async function rejects(promise, reason, code = DomainErrorCode.FORBIDDEN) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    if (reason) assert.equal(err.details?.reason, reason);
    return true;
  });
}

/** ADR-0012 D1: governance-capable = ADMIN and effective ACTIVE. */
async function capableAdminCount(now = new Date()) {
  const admins = await User.collection.find({ role: "ADMIN" }).toArray();
  return admins.filter((u) => {
    const state = u.accountState ?? "ACTIVE";
    if (state === "ACTIVE") return true;
    const r = u.accountRestriction;
    return r?.kind === "TEMPORARY" && r.expiresAt && new Date(r.expiresAt) <= now && (state === "MUTED" || state === "HARD_SUSPENDED");
  }).length;
}

describe("pure rule (domain/admin-targeting)", () => {
  it("self wins over admin; depends only on role and identity", () => {
    const id = new mongoose.Types.ObjectId();
    assert.equal(adminTargetingViolation({ actorId: id, target: { _id: id, role: "ADMIN" } }), SELF);
    assert.equal(adminTargetingViolation({ actorId: String(id), target: { _id: id, role: "USER" } }), SELF);
    assert.equal(adminTargetingViolation({ actorId: new mongoose.Types.ObjectId(), target: { _id: id, role: "ADMIN" } }), PEER);
    for (const role of ["USER", "EXPERT", undefined, null, "admin"]) {
      assert.equal(adminTargetingViolation({ actorId: new mongoose.Types.ObjectId(), target: { _id: id, role } }), null, String(role));
    }
    assert.deepEqual(NOT_ADMIN_FILTER, { role: { $ne: "ADMIN" } });
  });

  it("both reasons are client-safe; internal detail names still are not", () => {
    for (const r of [SELF, PEER]) assert.ok(isClientSafeReason(r));
    assert.ok(CLIENT_SAFE_REASONS.includes("SELF_GRANT_NOT_PERMITTED"));
    for (const r of ["expertCount", "ADMIN", "", undefined]) assert.equal(isClientSafeReason(r), false);
  });
});

describe("self-targeting is prohibited (every operation)", () => {
  for (const op of Object.keys(OPS)) {
    it(`${op}: service rejects SELF_TARGET_PROHIBITED, nothing changes`, async () => {
      const admin = await makeUser("ADMIN");
      const before = await snapshot(admin.id);
      await rejects(OPS[op].run(admin, admin.id), SELF);
      assert.deepEqual(await snapshot(admin.id), before);
    });

    it(`${op}: HTTP 403 FORBIDDEN with reason SELF_TARGET_PROHIBITED`, async () => {
      const admin = await makeUser("ADMIN");
      const before = await snapshot(admin.id);
      const res = await http_(op, admin, admin.id);
      assert.equal(res.status, 403);
      assert.equal(res.json.success, false);
      assert.equal(res.json.data, null);
      assert.equal(res.json.code, "FORBIDDEN");
      assert.equal(res.json.reason, SELF);
      assert.deepEqual(await snapshot(admin.id), before);
    });
  }

  it("also when the self-target is already restricted (service level; protection precedes state)", async () => {
    for (const state of ["MUTED", "HARD_SUSPENDED"]) {
      const admin = await makeUser("ADMIN");
      await setState(admin.id, state);
      const before = await snapshot(admin.id);
      for (const op of Object.keys(OPS)) await rejects(OPS[op].run(admin, admin.id), SELF);
      assert.deepEqual(await snapshot(admin.id), before, state);
    }
  });
});

describe("peer Admin targeting is prohibited in every target state", () => {
  for (const state of ["ACTIVE", "MUTED", "HARD_SUSPENDED"]) {
    for (const op of Object.keys(OPS)) {
      it(`${op} against an Admin that is ${state}: ADMIN_TARGET_PROTECTED, nothing changes`, async () => {
        const actor = await makeUser("ADMIN");
        const peer = await makeUser("ADMIN");
        await setState(peer.id, state);
        const before = await snapshot(peer.id);
        const actorBefore = await snapshot(actor.id);
        await rejects(OPS[op].run(actor, peer.id), PEER); // never INVALID_STATE (409), whatever the state
        assert.deepEqual(await snapshot(peer.id), before);
        assert.deepEqual(await snapshot(actor.id), actorBefore);
      });
    }
  }

  for (const op of Object.keys(OPS)) {
    it(`${op}: HTTP 403 FORBIDDEN with reason ADMIN_TARGET_PROTECTED and no other detail`, async () => {
      const actor = await makeUser("ADMIN");
      const peer = await makeUser("ADMIN");
      const before = await snapshot(peer.id);
      const res = await http_(op, actor, peer.id);
      assert.equal(res.status, 403);
      assert.deepEqual(Object.keys(res.json).sort(), ["code", "data", "message", "reason", "success"]);
      assert.equal(res.json.code, "FORBIDDEN");
      assert.equal(res.json.reason, PEER);
      assert.equal(res.json.data, null);
      assert.deepEqual(await snapshot(peer.id), before);
    });
  }
});

describe("existing USER / EXPERT governance is unchanged", () => {
  for (const role of ["USER", "EXPERT"]) {
    it(`${role}: mute, lift mute, suspend, lift suspension all still succeed with one event each`, async () => {
      const admin = await makeUser("ADMIN");
      const t = await makeUser(role);
      assert.equal((await OPS.mute.run(admin, t.id)).accountState, "MUTED");
      assert.equal((await OPS.liftMute.run(admin, t.id)).accountState, "ACTIVE");
      assert.equal((await OPS.suspend.run(admin, t.id)).accountState, "HARD_SUSPENDED");
      assert.equal((await OPS.liftSuspension.run(admin, t.id)).accountState, "ACTIVE");
      assert.equal(await GovernanceEvent.countDocuments({ target: t.id }), 4);
      assert.equal((await User.findById(t.id)).role, role);
    });

    it(`${role}: HTTP flows still return 200`, async () => {
      const admin = await makeUser("ADMIN");
      const t = await makeUser(role);
      for (const op of ["mute", "liftMute", "suspend", "liftSuspension"]) {
        const res = await http_(op, admin, t.id);
        assert.equal(res.status, 200, `${op}: ${res.text}`);
      }
    });

    it(`${role}: state preconditions and id handling keep their codes`, async () => {
      const admin = await makeUser("ADMIN");
      const t = await makeUser(role);
      await rejects(OPS.liftMute.run(admin, t.id), undefined, DomainErrorCode.INVALID_STATE);
      await OPS.mute.run(admin, t.id);
      await rejects(OPS.mute.run(admin, t.id), undefined, DomainErrorCode.INVALID_STATE);
    });
  }
});

describe("check order (ADR-0012 D8)", () => {
  it("authenticate -> ADMIN actor: non-ADMIN actors get a plain 403 with NO targeting reason; anonymous 401", async () => {
    const peer = await makeUser("ADMIN");
    for (const role of ["USER", "EXPERT"]) {
      const caller = await makeUser(role);
      for (const op of Object.keys(OPS)) {
        const res = await http_(op, caller, peer.id);
        assert.equal(res.status, 403, `${role} ${op}`);
        assert.equal(res.json.reason, undefined);
      }
    }
    for (const op of Object.keys(OPS)) {
      const res = await post(`/api/v1/accounts/${peer.id}/${OPS[op].path}`, null, OPS[op].body());
      assert.equal(res.status, 401);
    }
  });

  it("ids and target existence come before protection: malformed 400, unknown 404 (never 403)", async () => {
    const admin = await makeUser("ADMIN");
    for (const op of Object.keys(OPS)) {
      assert.equal((await post(`/api/v1/accounts/not-an-id/${OPS[op].path}`, admin.accessToken, OPS[op].body())).status, 400);
      assert.equal((await post(`/api/v1/accounts/${new mongoose.Types.ObjectId()}/${OPS[op].path}`, admin.accessToken, OPS[op].body())).status, 404);
    }
  });

  it("protection precedes state preconditions: a protected target never yields 409", async () => {
    const actor = await makeUser("ADMIN");
    const peer = await makeUser("ADMIN");
    await setState(peer.id, "MUTED");
    // mute on an already-MUTED Admin and lift-suspension on a non-suspended Admin are both 403, not 409
    assert.equal((await http_("mute", actor, peer.id)).status, 403);
    assert.equal((await http_("liftSuspension", actor, peer.id)).status, 403);
  });

  it("request-shape validation (unchanged) still precedes the target load: an invalid body is 400", async () => {
    const actor = await makeUser("ADMIN");
    const peer = await makeUser("ADMIN");
    const res = await post(`/api/v1/accounts/${peer.id}/suspend`, actor.accessToken, { kind: "NOPE" });
    assert.equal(res.status, 400);
  });
});

describe("rejected operations have no side effects", () => {
  it("no account mutation, version bump, credential-generation bump, session deletion, or event for any rejected op", async () => {
    const actor = await makeUser("ADMIN");
    const peer = await makeUser("ADMIN");
    for (const state of ["ACTIVE", "MUTED", "HARD_SUSPENDED"]) {
      await setState(peer.id, state);
      // a second session so deletion would be observable
      await Session.create({ userId: peer.id, tokenHash: `h-${state}-${n++}`, expiresAt: future(), authGeneration: 0 });
      const before = await snapshot(peer.id);
      assert.ok(before.sessions.length >= 2);
      for (const op of Object.keys(OPS)) {
        await rejects(OPS[op].run(actor, peer.id), PEER);
        await rejects(OPS[op].run(peer, peer.id), SELF);
      }
      const after = await snapshot(peer.id);
      assert.deepEqual(after, before, state);
      assert.equal(after.user.accountStateVersion, before.user.accountStateVersion);
      assert.equal(after.user.authGeneration, before.user.authGeneration);
    }
  });
});

describe("the write itself pins role, state and accountStateVersion", () => {
  it("every product write carries role != ADMIN, the expected state and the observed version; SYSTEM expiry carries no role pin", async () => {
    const admin = await makeUser("ADMIN");
    const t = await makeUser("USER");
    const filters = [];
    const orig = User.findOneAndUpdate;
    User.findOneAndUpdate = function (filter, ...rest) { filters.push(filter); return orig.call(this, filter, ...rest); };
    try {
      await OPS.mute.run(admin, t.id);
      await OPS.liftMute.run(admin, t.id);
      await OPS.suspend.run(admin, t.id);
      await OPS.liftSuspension.run(admin, t.id);
    } finally {
      User.findOneAndUpdate = orig;
    }
    assert.equal(filters.length, 4);
    for (const f of filters) {
      assert.deepEqual(f.role, { $ne: "ADMIN" });
      assert.ok(f.accountState !== undefined, "state pinned");
      assert.ok(f.accountStateVersion !== undefined || f.$or, "version pinned");
      assert.equal(String(f._id), t.id);
    }

    // SYSTEM expiry may lift an Admin's restriction (D2): its filter must not carry the role pin.
    await User.collection.updateOne({ _id: oid(t.id) }, { $set: { accountState: "MUTED", accountStateChangedAt: new Date(), accountRestriction: { kind: "TEMPORARY", expiresAt: new Date(Date.now() - HOUR) } } });
    const seen = [];
    User.findOneAndUpdate = function (filter, ...rest) { seen.push(filter); return orig.call(this, filter, ...rest); };
    try {
      assert.deepEqual(await expireMuteIfDue(t.id), { lifted: true });
    } finally {
      User.findOneAndUpdate = orig;
    }
    assert.equal(seen.length, 1);
    assert.equal(seen[0].role, undefined);
  });
});

describe("role changes between the pre-read and the write (deterministic barrier)", () => {
  const promote = (id) => User.collection.updateOne({ _id: oid(id) }, { $set: { role: "ADMIN" } });

  for (const op of ["mute", "suspend"]) {
    it(`${op}: target promoted to ADMIN after the pre-read -> STATE_RACE, no mutation, no event, no cleanup`, async () => {
      const actor = await makeUser("ADMIN");
      const t = await makeUser("USER");
      let reached = 0;
      governanceTestHooks.afterTargetRead = async ({ operation, targetId }) => {
        if (operation === op && targetId === t.id) { reached += 1; await promote(t.id); }
      };
      const before = await snapshot(t.id);
      await rejects(OPS[op].run(actor, t.id), undefined, DomainErrorCode.STATE_RACE);
      assert.equal(reached, 1);
      const after = await snapshot(t.id);
      assert.equal(after.user.role, "ADMIN");
      assert.equal(after.user.accountState, before.user.accountState);
      assert.equal(after.user.accountStateVersion, before.user.accountStateVersion);
      assert.deepEqual(after.sessions, before.sessions);
      assert.equal(after.allEvents, before.allEvents);
    });
  }

  for (const [op, state] of [["liftMute", "MUTED"], ["liftSuspension", "HARD_SUSPENDED"]]) {
    it(`${op}: target promoted to ADMIN after the pre-read -> STATE_RACE, still ${state}, no event, no session cleanup`, async () => {
      const actor = await makeUser("ADMIN");
      const t = await makeUser("USER");
      await setState(t.id, state);
      governanceTestHooks.afterRead = async ({ mode, targetId }) => {
        if (mode === "admin" && targetId === t.id) await promote(t.id);
      };
      const before = await snapshot(t.id);
      await rejects(OPS[op].run(actor, t.id), undefined, DomainErrorCode.STATE_RACE);
      const after = await snapshot(t.id);
      assert.equal(after.user.role, "ADMIN");
      assert.equal(after.user.accountState, state);
      assert.equal(after.user.accountStateVersion, before.user.accountStateVersion);
      assert.equal(after.user.authGeneration, before.user.authGeneration);
      assert.deepEqual(after.sessions, before.sessions);
      assert.equal(after.allEvents, before.allEvents);
    });
  }

  it("a role change that commits BEFORE the pre-read is the ordinary protected-target rejection", async () => {
    const actor = await makeUser("ADMIN");
    const t = await makeUser("USER");
    await promote(t.id);
    await rejects(OPS.suspend.run(actor, t.id), PEER);
  });
});

describe("mutual and multi-party Admin races", () => {
  it("two Admins suspending each other concurrently: both rejected, both stay capable", async () => {
    const a = await makeUser("ADMIN");
    const b = await makeUser("ADMIN");
    const results = await Promise.allSettled([OPS.suspend.run(a, b.id), OPS.suspend.run(b, a.id)]);
    for (const r of results) {
      assert.equal(r.status, "rejected");
      assert.equal(r.reason.code, DomainErrorCode.FORBIDDEN);
      assert.equal(r.reason.details.reason, PEER);
    }
    assert.equal(await capableAdminCount(), 2);
    assert.equal(await GovernanceEvent.countDocuments(), 0);
  });

  it("every ordered Admin pair and every operation, issued at once, is rejected; the Admin set is untouched", async () => {
    const admins = [await makeUser("ADMIN"), await makeUser("ADMIN"), await makeUser("ADMIN")];
    const attempts = [];
    for (const x of admins) for (const y of admins) for (const op of Object.keys(OPS)) attempts.push({ x, y, op });
    const results = await Promise.allSettled(attempts.map(({ x, y, op }) => OPS[op].run(x, y.id)));
    results.forEach((r, i) => {
      assert.equal(r.status, "rejected");
      assert.equal(r.reason.details.reason, attempts[i].x === attempts[i].y ? SELF : PEER);
    });
    assert.equal(await capableAdminCount(), 3);
    assert.equal(await GovernanceEvent.countDocuments(), 0);
  });

  it("over HTTP: two Admins suspending each other: both 403", async () => {
    const a = await makeUser("ADMIN");
    const b = await makeUser("ADMIN");
    const [r1, r2] = await Promise.all([http_("suspend", a, b.id), http_("suspend", b, a.id)]);
    assert.deepEqual([r1.status, r2.status], [403, 403]);
    assert.equal(await capableAdminCount(), 2);
  });
});

describe("last governance-capable Admin (ADR-0012 D3 / I1) through the product path", () => {
  it("the sole Admin cannot restrict itself in any way; the capable count stays 1", async () => {
    const sole = await makeUser("ADMIN");
    for (const op of Object.keys(OPS)) await rejects(OPS[op].run(sole, sole.id), SELF);
    assert.equal(await capableAdminCount(), 1);
  });

  it("a capable Admin cannot remove another Admin from the capable set, nor restore one", async () => {
    const a = await makeUser("ADMIN");
    const b = await makeUser("ADMIN");
    assert.equal(await capableAdminCount(), 2);
    for (const op of ["mute", "suspend"]) await rejects(OPS[op].run(a, b.id), PEER);
    assert.equal(await capableAdminCount(), 2);
    // an Operator-imposed MUTE makes B non-capable; A can neither deepen nor lift it
    await setState(b.id, "MUTED");
    assert.equal(await capableAdminCount(), 1);
    for (const op of Object.keys(OPS)) await rejects(OPS[op].run(a, b.id), PEER);
    assert.equal(await capableAdminCount(), 1);
  });

  it("USER/EXPERT governance never changes the capable-Admin count", async () => {
    const admin = await makeUser("ADMIN");
    const targets = [await makeUser("USER"), await makeUser("EXPERT")];
    for (const t of targets) {
      for (const op of ["mute", "liftMute", "suspend", "liftSuspension"]) await OPS[op].run(admin, t.id);
      assert.equal(await capableAdminCount(), 1);
    }
  });

  it("a muted (non-capable) Admin cannot govern, so it cannot be used to bypass protection", async () => {
    const a = await makeUser("ADMIN");
    const b = await makeUser("ADMIN");
    await setState(b.id, "MUTED");
    const res = await http_("suspend", b, a.id);
    assert.equal(res.status, 403);
    assert.equal(res.json.code, "ACCOUNT_MUTED");
    assert.equal(await capableAdminCount(), 1);
  });
});

describe("SYSTEM expiry is not subject to Admin protection (ADR-0012 D2)", () => {
  it("an Operator-imposed TEMPORARY suspension/mute on an Admin is lifted by SYSTEM expiry", async () => {
    const admin = await makeUser("ADMIN");
    await User.collection.updateOne(
      { _id: oid(admin.id) },
      { $set: { accountState: "HARD_SUSPENDED", accountStateChangedAt: new Date(), accountStateVersion: 1, accountRestriction: { kind: "TEMPORARY", expiresAt: new Date(Date.now() - HOUR) } } },
    );
    assert.deepEqual(await expireSuspensionIfDue(admin.id), { lifted: true });
    let u = await User.collection.findOne({ _id: oid(admin.id) });
    assert.equal(u.accountState, "ACTIVE");
    const ev = await GovernanceEvent.findOne({ target: admin.id });
    assert.equal(ev.actorType, "SYSTEM");

    await User.collection.updateOne(
      { _id: oid(admin.id) },
      { $set: { accountState: "MUTED", accountStateChangedAt: new Date(), accountRestriction: { kind: "TEMPORARY", expiresAt: new Date(Date.now() - HOUR) } } },
    );
    assert.deepEqual(await expireAccountRestrictionIfDue(admin.id), { lifted: true });
    u = await User.collection.findOne({ _id: oid(admin.id) });
    assert.equal(u.accountState, "ACTIVE");
    assert.equal(await capableAdminCount(), 1);
  });

  it("an INDEFINITE restriction on an Admin is never lifted by expiry", async () => {
    const admin = await makeUser("ADMIN");
    await setState(admin.id, "HARD_SUSPENDED");
    assert.deepEqual(await expireSuspensionIfDue(admin.id), { lifted: false });
    assert.equal((await User.collection.findOne({ _id: oid(admin.id) })).accountState, "HARD_SUSPENDED");
  });
});
