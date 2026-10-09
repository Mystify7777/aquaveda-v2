import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Knowledge } from "../src/models/Knowledge.js";
import { User } from "../src/models/User.js";
import { register } from "../src/services/auth.service.js";
import {
  createKnowledge,
  submitForReview,
  approve,
  reject,
  revise,
  listMyKnowledge,
  listReviewQueue,
  getKnowledgeForWorkflow,
} from "../src/services/knowledge.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import { setupTestDb, teardownTestDb, clearCollections, fakeObjectId } from "./helpers/testDb.js";
import { promoteToExpertViaLifecycle } from "./helpers/expert.js";

/**
 * Issue #74 — authenticated Knowledge workflow reads, against real
 * MongoDB. Actors are real User documents (not fakeActor) because these
 * reads populate author/reviewer and the tests assert on that.
 */

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

let seq = 0;
async function makeActor(role = "USER", name = `Person ${++seq}`) {
  const { user } = await register({
    name,
    email: `u${seq}-${Date.now()}-${Math.random()}@example.com`,
    password: "correcthorsebatterystaple",
  });
  // EXPERT is acquired through the real #91 lifecycle, never a direct write.
  // ADMIN has no lifecycle yet (#89): direct fixture write only.
  if (role === "EXPERT") await promoteToExpertViaLifecycle(user.id);
  else if (role !== "USER") await User.updateOne({ _id: user.id }, { $set: { role } });
  return { id: String(user.id), role };
}

const draftOf = (actor, title = "Drip irrigation") =>
  createKnowledge(actor, { title, body: `Body of ${title}` });

async function pendingOf(actor, title) {
  const k = await draftOf(actor, title);
  return submitForReview(actor, k._id);
}

async function setUpdatedAt(id, iso) {
  await Knowledge.updateOne({ _id: id }, { $set: { updatedAt: new Date(iso) } }, { timestamps: false });
}

const rejects = (fn, code) => assert.rejects(fn, (e) => e.code === code);

describe("listMyKnowledge", () => {
  it("requires an authenticated actor", async () => {
    await rejects(() => listMyKnowledge(null), DomainErrorCode.UNAUTHORIZED);
  });

  it("returns only the caller's own Knowledge, across every status", async () => {
    const me = await makeActor("USER");
    const other = await makeActor("USER");
    const expert = await makeActor("EXPERT");

    const d = await draftOf(me, "draft");
    await pendingOf(me, "pending");
    const rej = await pendingOf(me, "rejected");
    await reject(expert, rej._id, "needs sources");
    const app = await pendingOf(me, "approved");
    await approve(expert, app._id);
    await draftOf(other, "not mine");

    const res = await listMyKnowledge(me);
    assert.equal(res.total, 4);
    assert.deepEqual(res.items.map((i) => i.title).sort(), ["approved", "draft", "pending", "rejected"]);
    assert.deepEqual(
      new Set(res.items.map((i) => i.status)),
      new Set(["draft", "pending_review", "rejected", "approved"]),
    );
    assert.ok(res.items.every((i) => i.author._id === me.id));
    assert.ok(res.items.some((i) => i._id === String(d._id)));
  });

  it("filters by status", async () => {
    const me = await makeActor("USER");
    await draftOf(me, "a");
    await pendingOf(me, "b");
    const res = await listMyKnowledge(me, { status: "pending_review" });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].title, "b");
  });

  it("returns summaries: no body, no reviewHistory, author limited to _id/name/role", async () => {
    const me = await makeActor("USER", "Asha");
    await draftOf(me);
    const [item] = (await listMyKnowledge(me)).items;
    assert.deepEqual(Object.keys(item).sort(), [
      "_id", "author", "createdAt", "region", "status", "title", "updatedAt",
    ]);
    assert.deepEqual(Object.keys(item.author).sort(), ["_id", "name", "role"]);
    assert.equal(item.author.name, "Asha");
    assert.equal(typeof item._id, "string");
  });

  it("orders by updatedAt descending and paginates with correct totals", async () => {
    const me = await makeActor("USER");
    const a = await draftOf(me, "a");
    const b = await draftOf(me, "b");
    const c = await draftOf(me, "c");
    await setUpdatedAt(a._id, "2026-01-01T00:00:00Z");
    await setUpdatedAt(b._id, "2026-01-03T00:00:00Z");
    await setUpdatedAt(c._id, "2026-01-02T00:00:00Z");

    const p1 = await listMyKnowledge(me, { page: 1, limit: 2 });
    assert.deepEqual(p1.items.map((i) => i.title), ["b", "c"]);
    assert.equal(p1.total, 3);
    assert.equal(p1.totalPages, 2);
    const p2 = await listMyKnowledge(me, { page: 2, limit: 2 });
    assert.deepEqual(p2.items.map((i) => i.title), ["a"]);
  });

  it("returns an empty page, not an error, when the caller has no Knowledge", async () => {
    const me = await makeActor("USER");
    const res = await listMyKnowledge(me);
    assert.deepEqual(res, { items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});

describe("listReviewQueue", () => {
  it("requires an authenticated actor", async () => {
    await rejects(() => listReviewQueue(undefined), DomainErrorCode.UNAUTHORIZED);
  });

  it("is EXPERT-only: USER and ADMIN are FORBIDDEN", async () => {
    await rejects(async () => listReviewQueue(await makeActor("USER")), DomainErrorCode.FORBIDDEN);
    await rejects(async () => listReviewQueue(await makeActor("ADMIN")), DomainErrorCode.FORBIDDEN);
  });

  it("lists only pending_review articles", async () => {
    const expert = await makeActor("EXPERT");
    const author = await makeActor("USER");
    await draftOf(author, "draft");
    await pendingOf(author, "pending");
    const rej = await pendingOf(author, "rejected");
    await reject(expert, rej._id, "no");
    const app = await pendingOf(author, "approved");
    await approve(expert, app._id);

    const res = await listReviewQueue(expert);
    assert.equal(res.total, 1);
    assert.equal(res.items[0].title, "pending");
    assert.equal(res.items[0].status, "pending_review");
  });

  it("excludes the caller's own submissions (reviewer !== author already forbids acting on them)", async () => {
    const expert = await makeActor("EXPERT");
    const otherExpert = await makeActor("EXPERT");
    await pendingOf(expert, "mine");
    await pendingOf(otherExpert, "theirs");

    const res = await listReviewQueue(expert);
    assert.equal(res.total, 1);
    assert.equal(res.items[0].title, "theirs");
  });

  it("orders oldest first and paginates with correct totals", async () => {
    const expert = await makeActor("EXPERT");
    const author = await makeActor("USER");
    const a = await pendingOf(author, "a");
    const b = await pendingOf(author, "b");
    const c = await pendingOf(author, "c");
    await setUpdatedAt(a._id, "2026-01-02T00:00:00Z");
    await setUpdatedAt(b._id, "2026-01-01T00:00:00Z");
    await setUpdatedAt(c._id, "2026-01-03T00:00:00Z");

    const p1 = await listReviewQueue(expert, { page: 1, limit: 2 });
    assert.deepEqual(p1.items.map((i) => i.title), ["b", "a"]);
    assert.equal(p1.total, 3);
    assert.equal(p1.totalPages, 2);
    assert.deepEqual((await listReviewQueue(expert, { page: 2, limit: 2 })).items.map((i) => i.title), ["c"]);
  });

  it("returns summaries without body or reviewHistory, with a public-only author", async () => {
    const expert = await makeActor("EXPERT");
    const author = await makeActor("USER", "Asha");
    await pendingOf(author, "t");
    const [item] = (await listReviewQueue(expert)).items;
    assert.equal("body" in item, false);
    assert.equal("reviewHistory" in item, false);
    assert.deepEqual(Object.keys(item.author).sort(), ["_id", "name", "role"]);
  });
});

describe("getKnowledgeForWorkflow", () => {
  it("requires an authenticated actor", async () => {
    await rejects(() => getKnowledgeForWorkflow(null, fakeObjectId()), DomainErrorCode.UNAUTHORIZED);
  });

  it("lets the author read their own article in every status", async () => {
    const author = await makeActor("USER");
    const expert = await makeActor("EXPERT");
    const draft = await draftOf(author, "d");
    const pending = await pendingOf(author, "p");
    const rej = await pendingOf(author, "r");
    await reject(expert, rej._id, "needs sources");
    const app = await pendingOf(author, "a");
    await approve(expert, app._id);

    for (const [k, status] of [[draft, "draft"], [pending, "pending_review"], [rej, "rejected"], [app, "approved"]]) {
      const dto = await getKnowledgeForWorkflow(author, k._id);
      assert.equal(dto.status, status);
      assert.ok(dto.body.startsWith("Body of"));
    }
  });

  it("returns the full DTO: body, populated public author, populated public reviewers, feedback", async () => {
    const author = await makeActor("USER", "Asha");
    const expert = await makeActor("EXPERT", "Ravi");
    const k = await pendingOf(author, "t");
    await reject(expert, k._id, "needs sources");
    await revise(author, k._id, { body: "better" });
    await submitForReview(author, k._id);
    await approve(expert, k._id);

    const dto = await getKnowledgeForWorkflow(author, k._id);
    assert.deepEqual(Object.keys(dto).sort(), [
      "_id", "author", "body", "createdAt", "region", "reviewHistory", "status", "title", "updatedAt",
    ]);
    assert.deepEqual(dto.author, { _id: author.id, name: "Asha", role: "USER" });
    assert.equal(dto.reviewHistory.length, 2);
    const [first, second] = dto.reviewHistory;
    assert.equal(first.decision, "rejected");
    assert.equal(first.feedback, "needs sources");
    assert.deepEqual(first.reviewer, { _id: expert.id, name: "Ravi", role: "EXPERT" });
    assert.equal(second.decision, "approved");
    assert.equal("feedback" in second, false);
    assert.deepEqual(Object.keys(second.reviewer).sort(), ["_id", "name", "role"]);
    assert.equal("__v" in dto, false);
  });

  it("lets an EXPERT (non-author) read a pending_review article", async () => {
    const author = await makeActor("USER");
    const expert = await makeActor("EXPERT");
    const k = await pendingOf(author, "t");
    const dto = await getKnowledgeForWorkflow(expert, k._id);
    assert.equal(dto.status, "pending_review");
    assert.equal(dto.body, "Body of t");
  });

  it("EXPERT non-author gets NOT_FOUND for draft, rejected and approved articles", async () => {
    const author = await makeActor("USER");
    const expert = await makeActor("EXPERT");
    const draft = await draftOf(author, "d");
    const rej = await pendingOf(author, "r");
    await reject(expert, rej._id, "no");
    const app = await pendingOf(author, "a");
    await approve(expert, app._id);
    for (const k of [draft, rej, app]) {
      await rejects(() => getKnowledgeForWorkflow(expert, k._id), DomainErrorCode.NOT_FOUND);
    }
  });

  it("other USER and ADMIN (non-authors) get NOT_FOUND in every status, including pending_review", async () => {
    const author = await makeActor("USER");
    const expert = await makeActor("EXPERT");
    const stranger = await makeActor("USER");
    const admin = await makeActor("ADMIN");
    const draft = await draftOf(author, "d");
    const pending = await pendingOf(author, "p");
    const app = await pendingOf(author, "a");
    await approve(expert, app._id);
    for (const viewer of [stranger, admin]) {
      for (const k of [draft, pending, app]) {
        await rejects(() => getKnowledgeForWorkflow(viewer, k._id), DomainErrorCode.NOT_FOUND);
      }
    }
  });

  it("uses one indistinguishable NOT_FOUND for unauthorized and nonexistent ids", async () => {
    const author = await makeActor("USER");
    const stranger = await makeActor("USER");
    const k = await draftOf(author);

    const missingId = String(fakeObjectId());
    const err = (fn) => fn().then(() => null, (e) => e);
    const unauthorized = await err(() => getKnowledgeForWorkflow(stranger, k._id));
    const missing = await err(() => getKnowledgeForWorkflow(stranger, missingId));
    assert.equal(unauthorized.code, DomainErrorCode.NOT_FOUND);
    assert.equal(missing.code, DomainErrorCode.NOT_FOUND);
    assert.equal(unauthorized.message.replace(String(k._id), "X"), missing.message.replace(missingId, "X"));
  });

  it("rejects a malformed id with VALIDATION_FAILED", async () => {
    const me = await makeActor("USER");
    await rejects(() => getKnowledgeForWorkflow(me, "not-an-id"), DomainErrorCode.VALIDATION_FAILED);
  });

  it("maps an unresolvable reviewer (deleted user) to null instead of throwing or leaking the id", async () => {
    const author = await makeActor("USER");
    const expert = await makeActor("EXPERT");
    const k = await pendingOf(author, "t");
    await reject(expert, k._id, "no");
    await User.deleteOne({ _id: expert.id });
    const dto = await getKnowledgeForWorkflow(author, k._id);
    assert.equal(dto.reviewHistory[0].reviewer, null);
  });
});
