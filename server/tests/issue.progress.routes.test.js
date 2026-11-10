import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import mongoose from "mongoose";

import { Issue } from "../src/models/Issue.js";
import { deriveWaitingSince, responsibilityOf } from "../src/domain/issue-progress.js";
import { listAttentionQueue } from "../src/services/issue-attention.service.js";
import { acceptRemediation, grantRemediation, releaseRemediation } from "../src/services/remediation.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import {
  acknowledgedIssue,
  asActor,
  inProgressIssue,
  issueWithAcceptedGrant,
  issueWithPendingGrant,
  openIssue,
  resolvedIssue,
  verifiedIssue,
} from "./helpers/lifecycleFixtures.js";
import { assertNoPrivateKeys, makeHttpWorld, startIssueHttpApp } from "./helpers/issueHttp.js";

/**
 * Derived progress read model over real HTTP (#148, ADR-0008 section 6): the
 * three detail fields and the EXPERT needs-attention queues. Read-only: no
 * status, history, grant or schema is ever written by these reads.
 */

let app;
let w;

before(async () => {
  await setupTestDb();
  app = await startIssueHttpApp();
});
after(async () => {
  await app.close();
  await teardownTestDb();
});
beforeEach(async () => {
  await clearCollections();
  w = await makeHttpWorld();
});

const detail = (id, token) => app.request("GET", `/api/v1/issues/${id}`, { token });
const queue = (name, token, extra = "") => app.request("GET", `/api/v1/issues/attention?queue=${name}${extra}`, { token });
const setTimestamp = (id, date) =>
  Issue.updateOne({ _id: id }, { $set: { "statusHistory.0.timestamp": date, createdAt: date } });

describe("Issue detail: nextAction, waitingSince, resolutionDisputed", () => {
  it("each lifecycle state yields its code, the latest status-change time, and resolutionDisputed false", async () => {
    // one world per state so reporters and grantees stay distinct
    const states = [
      ["awaiting_acknowledgement", () => openIssue(w)],
      ["awaiting_responsible_party", async () => acknowledgedIssue(await makeHttpWorld())],
      ["awaiting_start", async () => issueWithAcceptedGrant(await makeHttpWorld())],
      ["work_in_progress", async () => inProgressIssue(await makeHttpWorld())],
      ["awaiting_verification", async () => resolvedIssue(await makeHttpWorld())],
      ["verified", async () => verifiedIssue(await makeHttpWorld())],
    ];
    for (const [expected, make] of states) {
      const issue = await make();
      const res = await detail(issue._id);
      assert.equal(res.status, 200, expected);
      const d = res.json.data;
      assert.equal(d.nextAction, expected);
      assert.equal(d.resolutionDisputed, false);
      const stored = await Issue.findById(issue._id).lean();
      const latest = stored.statusHistory.at(-1).timestamp;
      assert.equal(d.waitingSince, latest.toISOString(), `${expected} waitingSince`);
    }
  });

  it("the derived fields are identical for anonymous, signed-in, reporter, grantee and EXPERT viewers", async () => {
    const issue = await issueWithAcceptedGrant(w);
    const views = await Promise.all(
      [undefined, w.other.token, w.reporter.token, w.grantee.token, w.expert2.token, w.admin.token].map((t) => detail(issue._id, t)),
    );
    const pick = (r) => ({
      nextAction: r.json.data.nextAction,
      waitingSince: r.json.data.waitingSince,
      resolutionDisputed: r.json.data.resolutionDisputed,
    });
    for (const v of views) assert.deepEqual(pick(v), pick(views[0]));
  });

  it("a PENDING grant is indistinguishable from NO grant in the public detail, and the grantee is not exposed", async () => {
    const pending = await issueWithPendingGrant(w);
    const w2 = await makeHttpWorld();
    const none = await acknowledgedIssue(w2);
    const a = await detail(pending._id);
    const b = await detail(none._id);
    assert.equal(a.json.data.nextAction, "awaiting_responsible_party");
    assert.equal(a.json.data.nextAction, b.json.data.nextAction);
    assert.equal(a.json.data.assignee, null);
    assert.ok(!a.text.includes(w.grantee.id), "a pending grantee's identity stays private");
    assertNoPrivateKeys(assert, a.json);
  });

  it("a grant never moves waitingSince: only a status change does", async () => {
    const issue = await acknowledgedIssue(w);
    const before = (await detail(issue._id)).json.data;
    await grantRemediation(asActor(w.expert1), issue._id, w.grantee.id, {});
    await acceptRemediation(asActor(w.grantee), issue._id);
    const afterGrant = (await detail(issue._id)).json.data;
    assert.equal(afterGrant.nextAction, "awaiting_start"); // the code moved...
    assert.equal(afterGrant.waitingSince, before.waitingSince); // ...the clock did not

    await app.request("POST", `/api/v1/issues/${issue._id}/start`, { token: w.grantee.token, body: {} });
    const afterStart = (await detail(issue._id)).json.data;
    assert.equal(afterStart.nextAction, "work_in_progress");
    assert.notEqual(afterStart.waitingSince, before.waitingSince); // a status change moves it
  });

  it("is additive: existing detail fields are unchanged and the three new fields are exactly these", async () => {
    const issue = await issueWithAcceptedGrant(w);
    const d = (await detail(issue._id)).json.data;
    for (const k of ["_id", "title", "status", "statusHistory", "assignee", "activity", "reportedBy"]) assert.ok(k in d, k);
    for (const k of ["nextAction", "waitingSince", "resolutionDisputed"]) assert.ok(k in d, k);
    assertNoPrivateKeys(assert, { data: d });
  });

  it("list items and the created issue do NOT carry the derived fields (ADR-0008: detail read only)", async () => {
    const created = await app.request("POST", "/api/v1/issues", {
      token: w.reporter.token,
      body: { title: "New leak", description: "Water", location: { type: "Point", coordinates: [85.1, 25.6] } },
    });
    assert.equal(created.status, 201);
    for (const k of ["nextAction", "waitingSince", "resolutionDisputed"]) assert.ok(!(k in created.json.data), `created ${k}`);
    const list = await app.request("GET", "/api/v1/issues");
    for (const item of list.json.data.items) {
      for (const k of ["nextAction", "waitingSince", "resolutionDisputed"]) assert.ok(!(k in item), `list ${k}`);
    }
  });

  it("a lifecycle mutation response carries the updated derived state in its issue part", async () => {
    const issue = await openIssue(w);
    const res = await app.request("POST", `/api/v1/issues/${issue._id}/acknowledge`, { token: w.expert1.token, body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.data.issue.nextAction, "awaiting_responsible_party");
    assert.equal(res.json.data.issue.resolutionDisputed, false);
    assert.ok(res.json.data.issue.waitingSince);
  });

  it("reading changes nothing: the document is byte-identical after detail reads", async () => {
    const issue = await issueWithPendingGrant(w);
    const before = JSON.stringify(await Issue.findById(issue._id).lean());
    await detail(issue._id);
    await detail(issue._id, w.expert1.token);
    assert.equal(JSON.stringify(await Issue.findById(issue._id).lean()), before);
  });
});

describe("GET /api/v1/issues/attention: access and validation", () => {
  it("anonymous 401; USER 403; ADMIN 403 (Invariant 9: experts, not admins); EXPERT 200", async () => {
    assert.equal((await queue("unacknowledged")).status, 401);
    assert.equal((await queue("unacknowledged", w.other.token)).status, 403);
    const admin = await queue("unacknowledged", w.admin.token);
    assert.equal(admin.status, 403);
    assert.equal(admin.json.code, "FORBIDDEN");
    const ok = await queue("unacknowledged", w.expert1.token);
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(ok.json).sort(), ["data", "message", "success"]);
  });

  it("a queue is required and must be one of the three; page/limit are bounded", async () => {
    for (const path of [
      "/api/v1/issues/attention",
      "/api/v1/issues/attention?queue=everything",
      "/api/v1/issues/attention?queue=unassigned&page=0",
      "/api/v1/issues/attention?queue=unassigned&limit=0",
      "/api/v1/issues/attention?queue=unassigned&limit=51",
    ]) {
      const res = await app.request("GET", path, { token: w.expert1.token });
      assert.equal(res.status, 400, path);
      assert.equal(res.json.code, "VALIDATION_FAILED", path);
    }
  });

  it("is never cacheable by a shared cache, and is not shadowed by GET /:issueId", async () => {
    const res = await queue("unacknowledged", w.expert1.token);
    assert.equal(res.headers["cache-control"], "private, no-store");
    assert.equal(res.json.data.queue, "unacknowledged"); // not parsed as an Issue id (which would be 400)
  });
});

describe("GET /api/v1/issues/attention: queue membership and order", () => {
  /** open, acknowledged(none), acknowledged(pending), acknowledged(accepted), in_progress(accepted), in_progress(no grant), resolved, verified */
  async function seed() {
    const open = await openIssue(w);
    const ackNone = await acknowledgedIssue(await makeHttpWorld());
    const ackPending = await issueWithPendingGrant(await makeHttpWorld());
    const ackAccepted = await issueWithAcceptedGrant(await makeHttpWorld());
    const progAccepted = await inProgressIssue(await makeHttpWorld());
    const wReleased = await makeHttpWorld();
    const progReleased = await inProgressIssue(wReleased);
    await releaseRemediation(asActor(wReleased.grantee), progReleased._id, { note: "cannot continue" });
    const resolved = await resolvedIssue(await makeHttpWorld());
    const verified = await verifiedIssue(await makeHttpWorld());
    return { open, ackNone, ackPending, ackAccepted, progAccepted, progReleased, resolved, verified };
  }
  const ids = (res) => res.json.data.items.map((i) => i._id).sort();
  const sorted = (...docs) => docs.map((d) => String(d._id)).sort();

  it("unacknowledged = open only", async () => {
    const s = await seed();
    assert.deepEqual(ids(await queue("unacknowledged", w.expert1.token)), sorted(s.open));
  });

  it("unassigned = acknowledged/in_progress WITHOUT an accepted grant (none or pending); accepted ones are excluded", async () => {
    const s = await seed();
    const res = await queue("unassigned", w.expert1.token);
    assert.deepEqual(ids(res), sorted(s.ackNone, s.ackPending, s.progReleased));
    const byId = Object.fromEntries(res.json.data.items.map((i) => [i._id, i]));
    assert.equal(byId[String(s.ackNone._id)].responsibility, "none");
    assert.equal(byId[String(s.ackPending._id)].responsibility, "pending");
    assert.equal(byId[String(s.progReleased._id)].responsibility, "none");
    for (const i of res.json.data.items) assert.equal(i.nextAction, "awaiting_responsible_party");
  });

  it("awaiting_verification = resolved only; verified Issues are in no queue", async () => {
    const s = await seed();
    const res = await queue("awaiting_verification", w.expert1.token);
    assert.deepEqual(ids(res), sorted(s.resolved));
    assert.equal(res.json.data.items[0].nextAction, "awaiting_verification");
    assert.equal(res.json.data.items[0].responsibility, "accepted");
    for (const q of ["unacknowledged", "unassigned", "awaiting_verification"]) {
      assert.ok(!ids(await queue(q, w.expert1.token)).includes(String(s.verified._id)), q);
    }
  });

  it("orders oldest-waiting first with a stable tie-break, and reports total/pages", async () => {
    const a = await openIssue(await makeHttpWorld());
    const b = await openIssue(await makeHttpWorld());
    const c = await openIssue(await makeHttpWorld());
    await setTimestamp(a._id, new Date("2026-03-03T00:00:00Z"));
    await setTimestamp(b._id, new Date("2026-03-01T00:00:00Z"));
    await setTimestamp(c._id, new Date("2026-03-02T00:00:00Z"));
    const res = await queue("unacknowledged", w.expert1.token);
    assert.deepEqual(res.json.data.items.map((i) => i._id), [String(b._id), String(c._id), String(a._id)]);
    assert.equal(res.json.data.items[0].waitingSince, "2026-03-01T00:00:00.000Z");
    assert.equal(res.json.data.total, 3);
    assert.equal(res.json.data.totalPages, 1);
  });

  it("paginates: pages partition the queue, in order, with no overlap", async () => {
    const made = [];
    for (let i = 0; i < 5; i += 1) {
      const issue = await openIssue(await makeHttpWorld());
      await setTimestamp(issue._id, new Date(Date.UTC(2026, 3, 1 + i)));
      made.push(String(issue._id));
    }
    const p1 = await queue("unacknowledged", w.expert1.token, "&limit=2&page=1");
    const p2 = await queue("unacknowledged", w.expert1.token, "&limit=2&page=2");
    const p3 = await queue("unacknowledged", w.expert1.token, "&limit=2&page=3");
    const p4 = await queue("unacknowledged", w.expert1.token, "&limit=2&page=4");
    assert.deepEqual(
      [...p1.json.data.items, ...p2.json.data.items, ...p3.json.data.items].map((i) => i._id),
      made,
    );
    assert.deepEqual([p1.json.data.page, p1.json.data.limit, p1.json.data.total, p1.json.data.totalPages], [1, 2, 5, 3]);
    assert.equal(p3.json.data.items.length, 1);
    assert.deepEqual(p4.json.data.items, []);
  });

  it("an empty queue is a valid, complete response", async () => {
    const res = await queue("awaiting_verification", w.expert1.token);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { queue: "awaiting_verification", items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it("legacy documents without statusHistory fall back to createdAt and are still listed", async () => {
    const issue = await openIssue(w);
    await Issue.collection.updateOne({ _id: issue._id }, { $unset: { statusHistory: "" }, $set: { createdAt: new Date("2026-02-02T00:00:00Z") } });
    const res = await queue("unacknowledged", w.expert1.token);
    assert.equal(res.json.data.items[0].waitingSince, "2026-02-02T00:00:00.000Z");
  });
});

describe("GET /api/v1/issues/attention: contract and privacy", () => {
  it("rows have exactly the documented keys and name no person or grant", async () => {
    const pending = await issueWithPendingGrant(w);
    const res = await queue("unassigned", w.expert1.token);
    assert.equal(res.json.data.items.length, 1);
    assert.deepEqual(Object.keys(res.json.data.items[0]).sort(), [
      "_id", "category", "nextAction", "responsibility", "severity", "status", "title", "waitingSince",
    ]);
    assert.deepEqual(Object.keys(res.json.data).sort(), ["items", "limit", "page", "queue", "total", "totalPages"]);
    assertNoPrivateKeys(assert, res.json);
    for (const id of [w.grantee.id, w.reporter.id, w.expert1.id, w.expert2.id]) {
      assert.ok(!res.text.includes(id), "no user id in the queue");
    }
    assert.equal(res.json.data.items[0]._id, String(pending._id));
  });

  it("is read-only: reading every queue changes no document and creates no collection", async () => {
    await issueWithPendingGrant(w);
    await resolvedIssue(await makeHttpWorld());
    const before = JSON.stringify(await Issue.find().sort({ _id: 1 }).lean());
    for (const q of ["unacknowledged", "unassigned", "awaiting_verification"]) await queue(q, w.expert1.token);
    assert.equal(JSON.stringify(await Issue.find().sort({ _id: 1 }).lean()), before);
  });
});


// ---------------------------------------------------------------------------
// Determinism and consistency (review of #148): ties, malformed history,
// malformed grants, and parity between the aggregation and the domain rules.
// ---------------------------------------------------------------------------

const D1 = new Date("2026-05-01T00:00:00Z");
const D2 = new Date("2026-05-05T00:00:00Z");

async function rawIssue(world, fields = {}) {
  const doc = {
    title: "Raw",
    description: "Inserted below the model layer",
    domain: "water",
    status: "open",
    reportedBy: new mongoose.Types.ObjectId(world.reporter.id),
    location: { type: "Point", coordinates: [85.1, 25.6] },
    createdAt: D1,
    updatedAt: D1,
    ...fields,
  };
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
  const { insertedId } = await Issue.collection.insertOne(doc);
  return insertedId;
}

describe("attention queue ordering: ties are broken by _id and pages never overlap", () => {
  it("equal waitingSince values page in ascending _id order across page boundaries", async () => {
    const tie = new Date("2026-04-10T00:00:00Z");
    const tied = [];
    for (let i = 0; i < 5; i += 1) {
      const issue = await openIssue(await makeHttpWorld());
      await setTimestamp(issue._id, tie);
      tied.push(String(issue._id));
    }
    const older = await openIssue(await makeHttpWorld());
    await setTimestamp(older._id, new Date("2026-04-01T00:00:00Z"));
    const newer = await openIssue(await makeHttpWorld());
    await setTimestamp(newer._id, new Date("2026-04-20T00:00:00Z"));

    const expected = [String(older._id), ...[...tied].sort(), String(newer._id)];
    const seen = [];
    for (let page = 1; page <= 4; page += 1) {
      const res = await queue("unacknowledged", w.expert1.token, `&limit=2&page=${page}`);
      seen.push(...res.json.data.items.map((i) => i._id));
    }
    assert.deepEqual(seen, expected, "oldest first, then ties by _id ascending, then newest, no gaps or repeats");
    assert.equal(new Set(seen).size, seen.length);
  });
});

describe("attention queue ordering: the _id tie-break is what orders equal ages", () => {
  it("rows inserted in NON-ascending _id order still page in ascending _id order (insertion order is not the tie-break)", async () => {
    const tie = new Date("2026-06-01T00:00:00Z");
    const ids = [1, 2, 3, 4, 5].map((n) => new mongoose.Types.ObjectId(`66000000000000000000000${n}`));
    const insertionOrder = [ids[2], ids[0], ids[4], ids[1], ids[3]]; // 3,1,5,2,4
    for (const _id of insertionOrder) {
      await rawIssue(w, { _id, createdAt: tie, updatedAt: tie, statusHistory: [{ fromStatus: null, toStatus: "open", timestamp: tie }] });
    }
    const seen = [];
    for (let page = 1; page <= 3; page += 1) {
      const res = await queue("unacknowledged", w.expert1.token, `&limit=2&page=${page}`);
      seen.push(...res.json.data.items.map((i) => i._id));
    }
    assert.deepEqual(seen, ids.map(String), "ascending _id, regardless of how the rows were stored");
  });
});

describe("attention queue: malformed history is deterministic and matches deriveWaitingSince", () => {
  it("uses the LAST entry's timestamp else createdAt else unknown (null, ordered last), never the clock", async () => {
    const cases = {
      emptyHistory: { statusHistory: [] },
      lastEntryNoTimestamp: { statusHistory: [{ fromStatus: null, toStatus: "open", timestamp: D2 }, { toStatus: "open" }] },
      nullLastEntry: { statusHistory: [{ toStatus: "open", timestamp: D2 }, null] },
      nonArrayHistory: { statusHistory: "garbage" },
      noHistoryField: { statusHistory: undefined },
      wellFormed: { statusHistory: [{ fromStatus: null, toStatus: "open", timestamp: D2 }] },
      noAnyTime: { statusHistory: undefined, createdAt: undefined, updatedAt: undefined },
    };
    const ids = {};
    for (const [name, fields] of Object.entries(cases)) ids[name] = String(await rawIssue(w, fields));

    const res = await queue("unacknowledged", w.expert1.token, "&limit=50");
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const byId = Object.fromEntries(res.json.data.items.map((i) => [i._id, i.waitingSince]));

    // explicit expectations (the rule, spelled out)
    assert.equal(byId[ids.emptyHistory], D1.toISOString());
    assert.equal(byId[ids.lastEntryNoTimestamp], D1.toISOString(), "NOT the earlier entry's timestamp");
    assert.equal(byId[ids.nullLastEntry], D1.toISOString());
    assert.equal(byId[ids.nonArrayHistory], D1.toISOString());
    assert.equal(byId[ids.noHistoryField], D1.toISOString());
    assert.equal(byId[ids.wellFormed], D2.toISOString());
    assert.equal(byId[ids.noAnyTime], null, "unknown age is null, not the current time");

    // parity: the aggregation and the pure derivation agree on every stored shape
    for (const [name, id] of Object.entries(ids)) {
      const stored = await Issue.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
      const derived = deriveWaitingSince(stored);
      assert.equal(byId[id], derived ? derived.toISOString() : null, `${name}: aggregation vs deriveWaitingSince`);
    }

    // ordering: known ages ascending, unknown age LAST
    const order = res.json.data.items.map((i) => i._id);
    assert.equal(order.at(-1), ids.noAnyTime);
    assert.ok(order.indexOf(ids.wellFormed) > order.indexOf(ids.emptyHistory), "D2 sorts after D1");
  });
});

describe("attention queue: `unassigned` means NO ACCEPTED grant, consistent with responsibilityOf", () => {
  const oid = () => new mongoose.Types.ObjectId();

  it("lists every status/grant shape except an accepted grant, agreeing with the derivation", async () => {
    const shapes = {
      absent: { remediation: undefined },
      nullGrant: { remediation: null },
      emptyGrant: { remediation: {} },
      pending: { remediation: { grantId: oid(), actor: oid(), acceptedAt: null } },
      pendingNoField: { remediation: { grantId: oid(), actor: oid() } },
      accepted: { remediation: { grantId: oid(), actor: oid(), acceptedAt: D2 } },
      acceptedNoGrantId: { remediation: { actor: oid(), acceptedAt: D2 } },
      nullGrantId: { remediation: { grantId: null, acceptedAt: D2 } },
    };
    const ids = {};
    for (const [name, fields] of Object.entries(shapes)) {
      ids[name] = String(await rawIssue(w, { status: "acknowledged", statusHistory: [{ toStatus: "acknowledged", timestamp: D2 }], ...fields }));
    }
    const res = await queue("unassigned", w.expert1.token, "&limit=50");
    const listed = new Set(res.json.data.items.map((i) => i._id));

    // "accepted" requires a grant id AND an acceptance time: only that shape is excluded
    assert.equal(listed.has(ids.accepted), false);
    for (const name of Object.keys(shapes).filter((n) => n !== "accepted")) assert.ok(listed.has(ids[name]), `${name} must be listed`);

    // agreement with the domain, shape by shape
    for (const [name, id] of Object.entries(ids)) {
      const stored = await Issue.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
      assert.equal(listed.has(id), responsibilityOf(stored) !== "accepted", `${name}: query vs responsibilityOf`);
    }

    const row = (name) => res.json.data.items.find((i) => i._id === ids[name]);
    assert.equal(row("pending").responsibility, "pending");
    assert.equal(row("pendingNoField").responsibility, "pending");
    for (const n of ["absent", "nullGrant", "emptyGrant", "acceptedNoGrantId", "nullGrantId"]) assert.equal(row(n).responsibility, "none", n);
  });

  it("`responsibility` is always one of three plain strings, never an object or an identity", async () => {
    await issueWithPendingGrant(w);
    await issueWithAcceptedGrant(await makeHttpWorld());
    for (const q of ["unassigned", "awaiting_verification", "unacknowledged"]) {
      const res = await queue(q, w.expert1.token);
      for (const item of res.json.data.items) {
        assert.equal(typeof item.responsibility, "string");
        assert.ok(["none", "pending", "accepted"].includes(item.responsibility));
      }
    }
  });
});

describe("attention queue authorization is enforced by the service, not only the route", () => {
  it("a missing actor is UNAUTHORIZED; USER, ADMIN and look-alike roles are FORBIDDEN; EXPERT succeeds", async () => {
    for (const actor of [null, undefined, {}, { role: "EXPERT" }]) {
      await assert.rejects(() => listAttentionQueue(actor, { queue: "unacknowledged" }), (e) => e.code === "UNAUTHORIZED");
    }
    for (const role of ["USER", "ADMIN", "expert", "EXPERT ", "", "SUPERUSER"]) {
      await assert.rejects(
        () => listAttentionQueue({ id: w.other.id, role }, { queue: "unacknowledged" }),
        (e) => e.code === "FORBIDDEN",
        `role "${role}"`,
      );
    }
    const ok = await listAttentionQueue({ id: w.expert1.id, role: "EXPERT" }, { queue: "unacknowledged" });
    assert.deepEqual(ok.items, []);
  });

  it("authorization is checked before input: a non-EXPERT learns nothing about queue names", async () => {
    await assert.rejects(() => listAttentionQueue({ id: w.other.id, role: "USER" }, { queue: "nonsense" }), (e) => e.code === "FORBIDDEN");
    await assert.rejects(() => listAttentionQueue({ id: w.expert1.id, role: "EXPERT" }, { queue: "nonsense" }), (e) => e.code === "VALIDATION_FAILED");
  });

  it("the 403 over HTTP carries no role details", async () => {
    const res = await queue("unassigned", w.admin.token);
    assert.equal(res.status, 403);
    assert.deepEqual(Object.keys(res.json).sort(), ["code", "data", "message", "success"]);
    assert.ok(!/requiredRole|actualRole|EXPERT|ADMIN/.test(JSON.stringify(res.json.data)), "no role metadata in data");
    assert.ok(!res.text.includes("actualRole") && !res.text.includes("requiredRole"));
  });
});
