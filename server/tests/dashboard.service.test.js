import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Issue } from "../src/models/Issue.js";
import { User } from "../src/models/User.js";
import { getDashboard } from "../src/services/dashboard.service.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";
import { makeUser } from "./helpers/lifecycleFixtures.js";
import { actorOf, keysDeep, seedIssue, seedKnowledge, seedProject } from "./helpers/dashboardSeed.js";

/**
 * Dashboard aggregation (#53) against the real test MongoDB. Counts are exact:
 * every assertion is a hand-computed number from the seeded dataset.
 */

const ISSUE_ZERO = { open: 0, acknowledged: 0, in_progress: 0, resolved: 0, verified: 0 };
const KNOWLEDGE_ZERO = { draft: 0, pending_review: 0, approved: 0, rejected: 0 };

const EMPTY = {
  platform: {
    issues: { total: 0, byStatus: ISSUE_ZERO },
    knowledge: { approved: 0 },
    projects: { total: 0 },
  },
  mine: {
    issuesReported: { total: 0, byStatus: ISSUE_ZERO },
    knowledge: { total: 0, byStatus: KNOWLEDGE_ZERO },
    projects: { created: 0, contributing: 0 },
  },
};

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

/**
 * A reported: open x2, in_progress, verified           (4)
 * B reported: open, acknowledged, resolved             (3)
 * Knowledge A: draft, pending_review, approved x2, rejected (5); B: approved, draft x2 (3)
 * Projects: P1 creator A [B]; P2 creator B [A, A(dup)]; P3 creator A [A]; P4 creator C [A, B]
 */
async function seedWorld() {
  const [a, b, c] = [await makeUser("USER", "a"), await makeUser("USER", "b"), await makeUser("USER", "c")];
  const issues = [
    await seedIssue(a, "open"), await seedIssue(a, "open"), await seedIssue(a, "in_progress"), await seedIssue(a, "verified"),
    await seedIssue(b, "open"), await seedIssue(b, "acknowledged"), await seedIssue(b, "resolved"),
  ];
  for (const s of ["draft", "pending_review", "approved", "approved", "rejected"]) await seedKnowledge(a, s);
  for (const s of ["approved", "draft", "draft"]) await seedKnowledge(b, s);
  const originIssue = issues[0]._id;
  await seedProject({ creator: a, contributors: [b], originIssue });
  await seedProject({ creator: b, contributors: [a, a], originIssue });
  await seedProject({ creator: a, contributors: [a], originIssue });
  await seedProject({ creator: c, contributors: [a, b], originIssue });
  return { a, b, c, issues };
}

describe("authorization", () => {
  it("rejects a missing actor with UNAUTHORIZED", async () => {
    for (const actor of [null, undefined, {}, { role: "USER" }]) {
      await assert.rejects(() => getDashboard(actor), (e) => e.code === "UNAUTHORIZED");
    }
  });

  it("rejects an actor whose id is not a valid identifier with UNAUTHORIZED (no cast error escapes)", async () => {
    await assert.rejects(() => getDashboard({ id: "not-an-object-id", role: "USER" }), (e) => e.code === "UNAUTHORIZED");
  });

  it("any authenticated role gets the same contract shape", async () => {
    const shapes = [];
    for (const role of ["USER", "EXPERT", "ADMIN"]) {
      const u = await makeUser(role);
      shapes.push([...keysDeep(await getDashboard(actorOf(u)))].sort());
    }
    assert.deepEqual(shapes[0], shapes[1]);
    assert.deepEqual(shapes[1], shapes[2]);
  });
});

describe("empty dataset", () => {
  it("returns the full contract with zeros, never null or missing keys", async () => {
    const u = await makeUser("USER");
    const dash = await getDashboard(actorOf(u));
    assert.deepEqual(dash, EMPTY);
    const leaves = [];
    (function walk(v) {
      if (v && typeof v === "object") Object.values(v).forEach(walk);
      else leaves.push(v);
    })(dash);
    assert.ok(leaves.every((n) => Number.isInteger(n)));
  });

  it("a user with no records still sees correct platform numbers and empty `mine`", async () => {
    const { issues } = await seedWorld();
    const nobody = await makeUser("USER", "nobody");
    const dash = await getDashboard(actorOf(nobody));
    assert.equal(dash.platform.issues.total, issues.length);
    assert.deepEqual(dash.mine, EMPTY.mine);
  });
});

describe("populated dataset", () => {
  it("platform: counts of public data, whoever asks", async () => {
    const { a, b } = await seedWorld();
    const expected = {
      issues: { total: 7, byStatus: { open: 3, acknowledged: 1, in_progress: 1, resolved: 1, verified: 1 } },
      knowledge: { approved: 3 },
      projects: { total: 4 },
    };
    assert.deepEqual((await getDashboard(actorOf(a))).platform, expected);
    assert.deepEqual((await getDashboard(actorOf(b))).platform, expected);
  });

  it("mine: exact per-user numbers, and each user sees only their own", async () => {
    const { a, b, c } = await seedWorld();
    assert.deepEqual((await getDashboard(actorOf(a))).mine, {
      issuesReported: { total: 4, byStatus: { open: 2, acknowledged: 0, in_progress: 1, resolved: 0, verified: 1 } },
      knowledge: { total: 5, byStatus: { draft: 1, pending_review: 1, approved: 2, rejected: 1 } },
      projects: { created: 2, contributing: 2 },
    });
    assert.deepEqual((await getDashboard(actorOf(b))).mine, {
      issuesReported: { total: 3, byStatus: { open: 1, acknowledged: 1, in_progress: 0, resolved: 1, verified: 0 } },
      knowledge: { total: 3, byStatus: { draft: 2, pending_review: 0, approved: 1, rejected: 0 } },
      projects: { created: 1, contributing: 2 },
    });
    assert.deepEqual((await getDashboard(actorOf(c))).mine, {
      issuesReported: { total: 0, byStatus: ISSUE_ZERO },
      knowledge: { total: 0, byStatus: KNOWLEDGE_ZERO },
      projects: { created: 1, contributing: 0 },
    });
  });

  it("issue `total` always equals the sum of `byStatus` (platform and mine)", async () => {
    const { a } = await seedWorld();
    const { platform, mine } = await getDashboard(actorOf(a));
    for (const block of [platform.issues, mine.issuesReported, mine.knowledge]) {
      assert.equal(block.total, Object.values(block.byStatus).reduce((x, y) => x + y, 0));
    }
  });

  it("created and contributing are disjoint: a creator listed as contributor, or listed twice, is counted once", async () => {
    const { a } = await seedWorld();
    const { projects } = (await getDashboard(actorOf(a))).mine;
    // P3 (A creates, A also a contributor) is only `created`; P2 (A twice in contributors) counts once.
    assert.deepEqual(projects, { created: 2, contributing: 2 });
  });
});

describe("related or missing records", () => {
  it("a deleted reporter and a deleted origin Issue do not change or break any count", async () => {
    const { a, b, issues } = await seedWorld();
    const before = await getDashboard(actorOf(a));

    await User.deleteOne({ _id: b.id }); // B's issues/knowledge/projects are now orphaned
    await Issue.deleteOne({ _id: issues[0]._id }); // origin of every seeded project (an open issue of A)

    const after = await getDashboard(actorOf(a));
    // platform lost exactly the deleted issue; projects and knowledge are untouched; A's `mine` lost it too.
    assert.equal(after.platform.issues.total, before.platform.issues.total - 1);
    assert.equal(after.platform.issues.byStatus.open, before.platform.issues.byStatus.open - 1);
    assert.deepEqual(after.platform.projects, before.platform.projects);
    assert.deepEqual(after.platform.knowledge, before.platform.knowledge);
    assert.equal(after.mine.issuesReported.byStatus.open, before.mine.issuesReported.byStatus.open - 1);
    assert.deepEqual(after.mine.projects, before.mine.projects);
    assert.deepEqual(after.mine.knowledge, before.mine.knowledge);
  });

  it("a record with a status outside the contract vocabulary is ignored, keeping total === sum(byStatus)", async () => {
    const { a } = await seedWorld();
    await Issue.collection.insertOne({
      title: "legacy",
      description: "legacy status",
      status: "legacy_status",
      reportedBy: new mongoose.Types.ObjectId(a.id),
      location: { type: "Point", coordinates: [85, 25] },
    });
    const dash = await getDashboard(actorOf(a));
    assert.equal(dash.platform.issues.total, 7);
    assert.equal(dash.mine.issuesReported.total, 4);
    assert.ok(!("legacy_status" in dash.platform.issues.byStatus));
  });
});

describe("response contract", () => {
  it("has exactly the documented keys at every depth (no ids, no Mongoose metadata, no timestamps)", async () => {
    const { a } = await seedWorld();
    const keys = keysDeep(await getDashboard(actorOf(a)));
    assert.deepEqual([...keys].sort(), [
      "acknowledged", "approved", "byStatus", "contributing", "created", "draft", "in_progress",
      "issues", "issuesReported", "knowledge", "mine", "open", "pending_review", "platform",
      "projects", "rejected", "resolved", "total", "verified",
    ]);
    for (const forbidden of ["_id", "id", "__v", "createdAt", "updatedAt"]) assert.ok(!keys.has(forbidden), forbidden);
  });

  it("the status vocabularies are the documented ones (a schema change must be a conscious contract change)", () => {
    assert.deepEqual(Issue.schema.path("status").enumValues, ["open", "acknowledged", "in_progress", "resolved", "verified"]);
    assert.deepEqual(Object.keys(EMPTY.mine.knowledge.byStatus), ["draft", "pending_review", "approved", "rejected"]);
  });

  it("is a plain JSON value: serializing and parsing it changes nothing", async () => {
    const { a } = await seedWorld();
    const dash = await getDashboard(actorOf(a));
    assert.deepEqual(JSON.parse(JSON.stringify(dash)), dash);
  });

  it("is read-only: no document is written and no collection is created", async () => {
    const { a } = await seedWorld();
    const names = async () => (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name).sort();
    const counts = async () => [await Issue.countDocuments(), await User.countDocuments()];
    const [namesBefore, countsBefore] = [await names(), await counts()];
    await getDashboard(actorOf(a));
    assert.deepEqual(await names(), namesBefore);
    assert.deepEqual(await counts(), countsBefore);
  });
});
