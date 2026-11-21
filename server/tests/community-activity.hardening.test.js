import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Comment } from "../src/models/Comment.js";
import { Discussion } from "../src/models/Discussion.js";
import { Issue } from "../src/models/Issue.js";
import { Knowledge } from "../src/models/Knowledge.js";
import { User } from "../src/models/User.js";
import {
  buildCommunityActivityPipeline,
  listCommunityActivity,
} from "../src/services/community-activity.service.js";
import { communityActivityQuerySchema } from "../src/validation/community.validation.js";
import { setupTestDb, teardownTestDb, clearCollections } from "./helpers/testDb.js";

/**
 * Production-hardening tests for the Community Activity projection (#166).
 * Fixtures are inserted raw so timestamps are fully controlled and so private
 * workflow fields can be planted on source documents to prove they never leak.
 */

before(setupTestDb);
after(teardownTestDb);
beforeEach(async () => {
  await clearCollections();
  await Discussion.deleteMany({});
});

const oid = () => new mongoose.Types.ObjectId();
const at = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));
const TYPE_RANK = { DISCUSSION: 0, ISSUE: 1, KNOWLEDGE: 2 };

let author;
async function seedAuthor() {
  author = await User.create({
    name: "Public Name",
    email: `hardening-${Date.now()}@example.com`,
    passwordHash: "secret-hash",
    role: "EXPERT",
  });
}

const discussionDoc = (i, createdAt, extra = {}) => ({
  _id: oid(), title: `D${i}`, body: "private-body", category: "IDEA",
  status: "ACTIVE", author: author._id, createdAt, updatedAt: createdAt, ...extra,
});
const issueDoc = (i, extra = {}) => ({
  _id: oid(), title: `I${i}`, description: "private-description", status: "in_progress",
  reportedBy: author._id, location: { type: "Point", coordinates: [77.5, 12.9] },
  createdAt: at(0), updatedAt: at(0), ...extra,
});
const knowledgeDoc = (i, extra = {}) => ({
  _id: oid(), title: `K${i}`, body: "private-body", status: "approved",
  author: author._id, createdAt: at(0), updatedAt: at(0), ...extra,
});
const commentDoc = (refType, refId, createdAt, extra = {}) => ({
  _id: oid(), refType, refId, author: author._id, body: "c", createdAt, updatedAt: createdAt, ...extra,
});

function compare(a, b) {
  return (
    b.activityAt - a.activityAt ||
    TYPE_RANK[a.type] - TYPE_RANK[b.type] ||
    (a.resource.id < b.resource.id ? 1 : a.resource.id > b.resource.id ? -1 : 0)
  );
}

describe("Community Activity — pagination correctness", () => {
  it("pages never overlap, cover the full set, and follow the documented comparator (tied activityAt)", async () => {
    await seedAuthor();
    // 45 rows; only 3 distinct timestamps so most rows tie across all three sources.
    const ds = Array.from({ length: 15 }, (_, i) => discussionDoc(i, at(i % 3)));
    const is = Array.from({ length: 15 }, (_, i) => issueDoc(i));
    const ks = Array.from({ length: 15 }, (_, i) => knowledgeDoc(i));
    await Discussion.collection.insertMany(ds);
    await Issue.collection.insertMany(is);
    await Knowledge.collection.insertMany(ks);
    await Comment.collection.insertMany([
      ...is.map((d, i) => commentDoc("ISSUE", d._id, at(i % 3))),
      ...ks.map((d, i) => commentDoc("WIKI", d._id, at(i % 3))),
    ]);

    const limit = 10;
    const pages = [];
    for (let page = 1; page <= 5; page += 1) pages.push(await listCommunityActivity({ page, limit }));

    assert.deepEqual(pages.map((p) => p.items.length), [10, 10, 10, 10, 5]);
    for (const p of pages) {
      assert.equal(p.total, 45);
      assert.equal(p.totalPages, 5);
      assert.equal(p.limit, limit);
    }
    const all = pages.flatMap((p) => p.items);
    assert.equal(new Set(all.map((i) => i.id)).size, 45, "no duplicates across pages");

    const expected = all
      .map((i) => ({ ...i, activityAt: new Date(i.activityAt) }))
      .sort(compare)
      .map((i) => i.id);
    assert.deepEqual(all.map((i) => i.id), expected, "global order equals comparator order");

    // Stable: the same page requested twice yields the identical slice.
    const again = await listCommunityActivity({ page: 3, limit });
    assert.deepEqual(again.items.map((i) => i.id), pages[2].items.map((i) => i.id));
  });

  it("past-the-end page is an empty page that still reports the true total", async () => {
    await seedAuthor();
    await Discussion.collection.insertMany([discussionDoc(1, at(1)), discussionDoc(2, at(2))]);
    const res = await listCommunityActivity({ page: 9, limit: 10 });
    assert.deepEqual(res.items, []);
    assert.equal(res.total, 2);
    assert.equal(res.totalPages, 1);
  });

  it("empty feed is a successful empty page", async () => {
    const res = await listCommunityActivity({ page: 1, limit: 20 });
    assert.deepEqual(res, { items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it("query bounds: defaults, limit 50 accepted, 51 / 0 / page 0 / non-numeric rejected", () => {
    assert.deepEqual(communityActivityQuerySchema.parse({}), { page: 1, limit: 20 });
    assert.equal(communityActivityQuerySchema.safeParse({ limit: "50" }).success, true);
    for (const bad of [{ limit: "51" }, { limit: "0" }, { page: "0" }, { page: "x" }, { limit: "1.5" }]) {
      assert.equal(communityActivityQuerySchema.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });
});

describe("Community Activity — projection and privacy contract", () => {
  it("items expose exactly the contract keys and no private source fields", async () => {
    await seedAuthor();
    const d = discussionDoc(1, at(5));
    const i = issueDoc(1, {
      remediation: { grantId: oid(), actor: oid(), grantedBy: oid(), grantedAt: at(1), acceptedAt: null },
      remediationHistory: [{ type: "granted", actor: oid(), note: "private-remediation-note" }],
      statusHistory: [{ fromStatus: null, toStatus: "open", actor: author._id, timestamp: at(0), note: "private-status-note" }],
      disputeHistory: [{ type: "raised", note: "private-dispute-reason" }],
    });
    const k = knowledgeDoc(1, { reviewHistory: [{ decision: "rejected", feedback: "private-feedback" }] });
    await Discussion.collection.insertOne(d);
    await Issue.collection.insertOne(i);
    await Knowledge.collection.insertOne(k);
    await Comment.collection.insertMany([commentDoc("ISSUE", i._id, at(6)), commentDoc("WIKI", k._id, at(7))]);

    const { items } = await listCommunityActivity({ page: 1, limit: 20 });
    assert.equal(items.length, 3);
    for (const item of items) {
      assert.deepEqual(
        Object.keys(item).sort(),
        ["activityAt", "author", "category", "commentCount", "id", "resource", "title", "type"],
      );
      assert.deepEqual(Object.keys(item.resource).sort(), ["id", "type"]);
      assert.deepEqual(Object.keys(item.author).sort(), ["_id", "name", "role"]);
      assert.equal(item.id, `${item.type.toLowerCase()}:${item.resource.id}`);
      assert.equal(item.resource.type, item.type);
    }
    const wire = JSON.stringify(items);
    for (const secret of [
      "private-body", "private-description", "private-remediation-note", "private-status-note",
      "private-dispute-reason", "private-feedback", "secret-hash", "example.com", "remediation",
      "statusHistory", "reviewHistory", "disputeHistory", "coordinates",
    ]) {
      assert.equal(wire.includes(secret), false, `leaked: ${secret}`);
    }
  });

  it("Issue/Knowledge appear only with a comment of the matching target type", async () => {
    await seedAuthor();
    const quiet = issueDoc(1);
    const wrongType = issueDoc(2);
    const quietK = knowledgeDoc(1);
    const wrongTypeK = knowledgeDoc(2);
    await Issue.collection.insertMany([quiet, wrongType]);
    await Knowledge.collection.insertMany([quietK, wrongTypeK]);
    await Comment.collection.insertMany([
      commentDoc("WIKI", wrongType._id, at(1)), // right id, wrong refType for an Issue
      commentDoc("ISSUE", wrongTypeK._id, at(1)), // right id, wrong refType for Knowledge
    ]);
    const res = await listCommunityActivity({ page: 1, limit: 20 });
    assert.deepEqual(res.items, []);
    assert.equal(res.total, 0);
  });

  it("commentCount counts every comment on the target, replies included; activityAt is the latest", async () => {
    await seedAuthor();
    const issue = issueDoc(1);
    await Issue.collection.insertOne(issue);
    const top = commentDoc("ISSUE", issue._id, at(1));
    await Comment.collection.insertMany([
      top,
      commentDoc("ISSUE", issue._id, at(3)),
      commentDoc("ISSUE", issue._id, at(2), { parentComment: top._id }),
    ]);
    const { items } = await listCommunityActivity({ page: 1, limit: 20 });
    assert.equal(items[0].commentCount, 3);
    assert.equal(new Date(items[0].activityAt).getTime(), at(3).getTime());
  });

  it("is read-only: no source document is created, changed or removed", async () => {
    await seedAuthor();
    const d = discussionDoc(1, at(1));
    await Discussion.collection.insertOne(d);
    const before = await Discussion.collection.findOne({ _id: d._id });
    const counts = async () => [await Discussion.countDocuments(), await Issue.countDocuments(), await Knowledge.countDocuments(), await Comment.countDocuments()];
    const c0 = await counts();
    await listCommunityActivity({ page: 1, limit: 20 });
    assert.deepEqual(await counts(), c0);
    assert.deepEqual(await Discussion.collection.findOne({ _id: d._id }), before);
  });
});

describe("Community Activity — bounded data access", () => {
  async function seedVolume(n) {
    await clearCollections();
    await Discussion.deleteMany({});
    await seedAuthor();
    const ds = Array.from({ length: n }, (_, i) => discussionDoc(i, at(i)));
    const is = Array.from({ length: n }, (_, i) => issueDoc(i));
    const ks = Array.from({ length: n }, (_, i) => knowledgeDoc(i));
    await Discussion.collection.insertMany(ds);
    await Issue.collection.insertMany(is);
    await Knowledge.collection.insertMany(ks);
    await Comment.collection.insertMany([
      ...is.map((d, i) => commentDoc("ISSUE", d._id, at(i))),
      ...ks.map((d, i) => commentDoc("WIKI", d._id, at(i))),
      ...ds.map((d, i) => commentDoc("DISCUSSION", d._id, at(i + 1))),
    ]);
  }

  let lastAggregateOptions;

  async function countOperations(fn) {
    const ops = [];
    mongoose.set("debug", (collection, method, ...args) => {
      ops.push(`${collection}.${method}`);
      lastAggregateOptions = args[1];
    });
    try {
      const result = await fn();
      return { ops, result };
    } finally {
      mongoose.set("debug", false);
    }
  }

  it("issues exactly one database operation regardless of source size, and returns at most `limit` rows", async () => {
    const limit = 5;
    await seedVolume(10);
    const small = await countOperations(() => listCommunityActivity({ page: 1, limit }));
    await seedVolume(120);
    const large = await countOperations(() => listCommunityActivity({ page: 1, limit }));

    assert.deepEqual(small.ops, ["discussions.aggregate"]);
    // The global $sort spills to disk rather than failing as the population grows.
    assert.equal(lastAggregateOptions?.allowDiskUse, true);
    assert.deepEqual(large.ops, small.ops, "query count must not depend on population size (no N+1)");
    assert.equal(small.result.items.length, limit);
    assert.equal(large.result.items.length, limit, "application receives one page, not the population");
    assert.equal(large.result.total, 360);
  });

  it("every comment lookup is index-backed: no collection scan, refType_1_refId_1 used", async () => {
    await seedVolume(25);
    const explain = await Discussion.aggregate(buildCommunityActivityPipeline({ page: 1, limit: 5 }))
      .allowDiskUse(true)
      .explain("executionStats");

    const lookups = [];
    (function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        if (node.$lookup && typeof node.$lookup.from === "string" && "collectionScans" in node) {
          lookups.push(node);
        }
        Object.values(node).forEach(walk);
      }
    })(explain);

    const commentLookups = lookups.filter((l) => l.$lookup.from === Comment.collection.name);
    assert.ok(commentLookups.length >= 1, "comment lookup stats present in explain output");
    for (const l of commentLookups) {
      assert.equal(l.collectionScans, 0, "comment lookup must not scan the collection");
      assert.ok(l.indexesUsed?.includes("refType_1_refId_1"), "must use the existing (refType, refId) index");
    }
  });

  it("pipeline: comment stats use $sum/$max (no per-target sort); only the global sort spills", () => {
    const text = JSON.stringify(buildCommunityActivityPipeline({ page: 1, limit: 5 }));
    assert.equal((text.match(/"\$first"/g) ?? []).length, 0);
    assert.ok(text.includes('"$max"'));
    // Exactly one $sort at pipeline level: the global comparator.
    const top = buildCommunityActivityPipeline({ page: 1, limit: 5 }).filter((s) => s.$sort);
    assert.equal(top.length, 1);
    assert.deepEqual(top[0].$sort, { activityAt: -1, sourceType: 1, resourceObjectId: -1 });
  });
});
