import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Knowledge } from "../src/models/Knowledge.js";
import { User } from "../src/models/User.js";
import {
  createKnowledge,
  submitForReview,
  approve,
  reject,
  revise,
  listApprovedKnowledge,
  getApprovedKnowledgeById,
} from "../src/services/knowledge.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import {
  setupTestDb,
  teardownTestDb,
  clearCollections,
  fakeActor,
  fakeObjectId,
} from "./helpers/testDb.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

async function makeDraft(author = fakeActor("USER")) {
  const knowledge = await createKnowledge(author, {
    title: "Drip irrigation basics",
    body: "How to set up a low-cost system",
  });
  return { knowledge, author };
}

async function makePendingReview(author = fakeActor("USER")) {
  const { knowledge } = await makeDraft(author);
  const submitted = await submitForReview(author, knowledge._id);
  return { knowledge: submitted, author };
}

describe("knowledge.service — createKnowledge", () => {
  it("creates a Knowledge document with status 'draft'", async () => {
    const { knowledge, author } = await makeDraft();
    assert.equal(knowledge.status, "draft");
    assert.equal(String(knowledge.author), author.id);
    assert.equal(knowledge.reviewHistory.length, 0);
  });

  it("ignores caller-supplied status/reviewHistory/author", async () => {
    const actor = fakeActor("USER");
    const other = fakeObjectId();
    const knowledge = await createKnowledge(actor, {
      title: "t",
      body: "b",
      status: "approved",
      author: other,
      reviewHistory: [{ decision: "approved", reviewer: other }],
    });
    assert.equal(knowledge.status, "draft");
    assert.equal(String(knowledge.author), actor.id);
    assert.equal(knowledge.reviewHistory.length, 0);
  });
});

describe("knowledge.service — submitForReview", () => {
  it("author can submit their own draft; status becomes pending_review, no history entry added", async () => {
    const { knowledge, author } = await makeDraft();
    const updated = await submitForReview(author, knowledge._id);
    assert.equal(updated.status, "pending_review");
    assert.equal(updated.reviewHistory.length, 0);
  });

  it("a non-author cannot submit someone else's draft", async () => {
    const { knowledge } = await makeDraft(fakeActor("USER"));
    await assert.rejects(
      () => submitForReview(fakeActor("USER"), knowledge._id),
      (err) => {
        assert.equal(err.code, DomainErrorCode.FORBIDDEN);
        return true;
      },
    );
  });

  it("submitting a non-draft document fails with INVALID_STATE", async () => {
    const { knowledge, author } = await makePendingReview();
    await assert.rejects(
      () => submitForReview(author, knowledge._id),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_STATE);
        return true;
      },
    );
  });
});

describe("knowledge.service — approve", () => {
  it("an EXPERT who is not the author can approve", async () => {
    const { knowledge, author } = await makePendingReview();
    const expert = fakeActor("EXPERT");
    const updated = await approve(expert, knowledge._id);
    assert.equal(updated.status, "approved");
    assert.equal(updated.reviewHistory.length, 1);
    assert.equal(updated.reviewHistory[0].decision, "approved");
    assert.equal(String(updated.reviewHistory[0].reviewer), expert.id);
    assert.notEqual(String(updated.reviewHistory[0].reviewer), author.id);
  });

  it("a non-EXPERT cannot approve", async () => {
    const { knowledge } = await makePendingReview();
    await assert.rejects(
      () => approve(fakeActor("USER"), knowledge._id),
      (err) => {
        assert.equal(err.code, DomainErrorCode.FORBIDDEN);
        return true;
      },
    );
  });

  it("an author cannot approve their own submission, even if they hold EXPERT", async () => {
    const authorExpert = fakeActor("EXPERT");
    const { knowledge } = await makePendingReview(authorExpert);
    await assert.rejects(
      () => approve(authorExpert, knowledge._id),
      (err) => {
        assert.equal(err.code, DomainErrorCode.FORBIDDEN);
        return true;
      },
    );
  });

  it("approving a draft (not pending_review) fails with INVALID_STATE", async () => {
    const { knowledge } = await makeDraft();
    await assert.rejects(
      () => approve(fakeActor("EXPERT"), knowledge._id),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_STATE);
        return true;
      },
    );
  });
});

describe("knowledge.service — reject", () => {
  it("an EXPERT who is not the author can reject with feedback", async () => {
    const { knowledge, author } = await makePendingReview();
    const expert = fakeActor("EXPERT");
    const updated = await reject(expert, knowledge._id, "needs more sourcing");
    assert.equal(updated.status, "rejected");
    assert.equal(updated.reviewHistory.length, 1);
    assert.equal(updated.reviewHistory[0].decision, "rejected");
    assert.equal(updated.reviewHistory[0].feedback, "needs more sourcing");
    assert.notEqual(String(updated.reviewHistory[0].reviewer), author.id);
  });

  it("rejecting without feedback fails with INVALID_STATE", async () => {
    const { knowledge } = await makePendingReview();
    await assert.rejects(
      () => reject(fakeActor("EXPERT"), knowledge._id, ""),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_STATE);
        return true;
      },
    );
  });

  it("rejecting with whitespace-only feedback fails", async () => {
    const { knowledge } = await makePendingReview();
    await assert.rejects(() =>
      reject(fakeActor("EXPERT"), knowledge._id, "   "),
    );
  });

  it("a non-EXPERT cannot reject", async () => {
    const { knowledge } = await makePendingReview();
    await assert.rejects(
      () => reject(fakeActor("USER"), knowledge._id, "feedback"),
      (err) => {
        assert.equal(err.code, DomainErrorCode.FORBIDDEN);
        return true;
      },
    );
  });
});

describe("knowledge.service — revise", () => {
  async function makeRejected(author = fakeActor("USER")) {
    const { knowledge } = await makePendingReview(author);
    const rejected = await reject(
      fakeActor("EXPERT"),
      knowledge._id,
      "please improve sourcing",
    );
    return { knowledge: rejected, author };
  }

  it("author can revise a rejected article; status returns to draft", async () => {
    const { knowledge, author } = await makeRejected();
    const revised = await revise(author, knowledge._id, {
      title: "Better title",
      body: "Improved body",
    });
    assert.equal(revised.status, "draft");
    assert.equal(revised.title, "Better title");
    assert.equal(revised.body, "Improved body");
  });

  it("revise does NOT append a reviewHistory entry", async () => {
    const { knowledge, author } = await makeRejected();
    const revised = await revise(author, knowledge._id, { title: "t2" });
    assert.equal(revised.reviewHistory.length, 1); // unchanged from the rejection
  });

  it("a non-author cannot revise", async () => {
    const { knowledge } = await makeRejected(fakeActor("USER"));
    await assert.rejects(
      () => revise(fakeActor("USER"), knowledge._id, { title: "hijack" }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.FORBIDDEN);
        return true;
      },
    );
  });

  it("revising a non-rejected document fails with INVALID_STATE", async () => {
    const { knowledge, author } = await makeDraft();
    await assert.rejects(
      () => revise(author, knowledge._id, { title: "t" }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_STATE);
        return true;
      },
    );
  });

  it("revise cannot change author, even if the caller supplies one", async () => {
    const { knowledge, author } = await makeRejected();
    const intruder = fakeObjectId();
    const revised = await revise(author, knowledge._id, {
      title: "t",
      author: intruder,
    });
    assert.equal(String(revised.author), author.id);
  });
});

describe("knowledge.service — concurrency", () => {
  it("two concurrent approve attempts on the same document — exactly one succeeds", async () => {
    const { knowledge } = await makePendingReview();
    const expertA = fakeActor("EXPERT");
    const expertB = fakeActor("EXPERT");

    const results = await Promise.allSettled([
      approve(expertA, knowledge._id),
      approve(expertB, knowledge._id),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    assert.equal(succeeded.length, 1);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].reason.code, DomainErrorCode.STATE_RACE);

    const reloaded = await Knowledge.findById(knowledge._id);
    assert.equal(reloaded.status, "approved");
    assert.equal(reloaded.reviewHistory.length, 1); // only the winner's decision recorded
  });

  it("one approve and one reject racing on the same document — exactly one wins, history has exactly one entry", async () => {
    const { knowledge } = await makePendingReview();
    const expertA = fakeActor("EXPERT");
    const expertB = fakeActor("EXPERT");

    const results = await Promise.allSettled([
      approve(expertA, knowledge._id),
      reject(expertB, knowledge._id, "concurrent rejection attempt"),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    assert.equal(succeeded.length, 1);

    const reloaded = await Knowledge.findById(knowledge._id);
    assert.equal(reloaded.reviewHistory.length, 1);
    assert.ok(["approved", "rejected"].includes(reloaded.status));
  });
});

describe("listApprovedKnowledge (Issue #48 — public read)", () => {
  it("only ever returns approved articles, never draft/pending_review/rejected", async () => {
    const author = fakeActor("USER");
    const expert = fakeActor("EXPERT");

    const draft = await createKnowledge(author, { title: "draft", body: "b" });

    const toApprove = await createKnowledge(author, { title: "to-approve", body: "b" });
    await submitForReview(author, toApprove._id);
    await approve(expert, toApprove._id);

    const toReject = await createKnowledge(author, { title: "to-reject", body: "b" });
    await submitForReview(author, toReject._id);
    await reject(expert, toReject._id, "needs work");

    const pending = await createKnowledge(author, { title: "pending", body: "b" });
    await submitForReview(author, pending._id);

    const result = await listApprovedKnowledge();
    const ids = result.items.map((i) => String(i._id));

    assert.ok(ids.includes(String(toApprove._id)));
    assert.ok(!ids.includes(String(draft._id)));
    assert.ok(!ids.includes(String(toReject._id)));
    assert.ok(!ids.includes(String(pending._id)));
    assert.equal(result.total, 1);
  });

  it("cannot be made to return non-approved content via any query parameter — no status parameter exists", async () => {
    const author = fakeActor("USER");
    await createKnowledge(author, { title: "draft", body: "b" });

    // listApprovedKnowledge only accepts {page, limit} — passing an
    // arbitrary extra key (as if trying to smuggle a status override)
    // has no effect, since the service never reads anything but
    // page/limit from its argument.
    const result = await listApprovedKnowledge({ status: "draft", page: 1, limit: 20 });
    assert.equal(result.total, 0);
  });

  it("respects page/limit and reports totalPages", async () => {
    const author = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    for (let i = 0; i < 3; i++) {
      const k = await createKnowledge(author, { title: `k${i}`, body: "b" });
      await submitForReview(author, k._id);
      await approve(expert, k._id);
    }

    const result = await listApprovedKnowledge({ page: 2, limit: 2 });
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 3);
    assert.equal(result.totalPages, 2);
  });
});

describe("getApprovedKnowledgeById (Issue #48 — public read)", () => {
  it("returns an approved article", async () => {
    const author = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    const k = await createKnowledge(author, { title: "t", body: "b" });
    await submitForReview(author, k._id);
    await approve(expert, k._id);

    const result = await getApprovedKnowledgeById(k._id);
    assert.equal(String(result._id), String(k._id));
  });

  it("throws NOT_FOUND (not FORBIDDEN) for a real but non-approved article — never discloses its existence/state", async () => {
    const author = fakeActor("USER");
    const draft = await createKnowledge(author, { title: "draft", body: "b" });

    await assert.rejects(
      () => getApprovedKnowledgeById(draft._id),
      (err) => err.code === DomainErrorCode.NOT_FOUND,
    );
  });

  it("throws NOT_FOUND for a well-formed but nonexistent id", async () => {
    await assert.rejects(
      () => getApprovedKnowledgeById(fakeObjectId()),
      (err) => err.code === DomainErrorCode.NOT_FOUND,
    );
  });

  it("throws VALIDATION_FAILED (CastError translation) for a malformed id", async () => {
    await assert.rejects(
      () => getApprovedKnowledgeById("not-a-valid-object-id"),
      (err) => err.code === DomainErrorCode.VALIDATION_FAILED,
    );
  });

  it("populates author with name/role only — never email or passwordHash", async () => {
    const user = await User.create({
      name: "Real Author",
      email: "author@example.com",
      passwordHash: "irrelevant-for-this-test",
      role: "USER",
    });
    const expert = fakeActor("EXPERT");
    const actor = { id: String(user._id), role: "USER" };
    const k = await createKnowledge(actor, { title: "t", body: "b" });
    await submitForReview(actor, k._id);
    await approve(expert, k._id);

    const result = await getApprovedKnowledgeById(k._id);
    assert.equal(result.author.name, "Real Author");
    assert.equal(result.author.role, "USER");
    assert.equal(result.author.email, undefined);
    assert.equal(result.author.passwordHash, undefined);
  });
});
