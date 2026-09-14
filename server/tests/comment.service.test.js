import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createIssue } from "../src/services/issue.service.js";
import { createKnowledge, submitForReview, approve, reject } from "../src/services/knowledge.service.js";
import { createComment, getCommentThread } from "../src/services/comment.service.js";
import { User } from "../src/models/User.js";
import { DomainErrorCode } from "../src/services/errors.js";
import {
  setupTestDb,
  teardownTestDb,
  clearCollections,
  fakeActor,
  fakeObjectId,
  validPoint,
} from "./helpers/testDb.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(clearCollections);

async function makeIssue() {
  return createIssue(fakeActor("USER"), {
    title: "Leaking pipe",
    description: "d",
    location: validPoint(),
  });
}

async function makeKnowledge() {
  return createKnowledge(fakeActor("USER"), { title: "t", body: "b" });
}

describe("comment.service — createComment", () => {
  it("creates a top-level Comment on an Issue", async () => {
    const issue = await makeIssue();
    const author = fakeActor("USER");
    const comment = await createComment(author, {
      refType: "ISSUE",
      refId: issue._id,
      body: "This is affecting my street too.",
    });
    assert.equal(comment.refType, "ISSUE");
    assert.equal(String(comment.refId), String(issue._id));
    assert.equal(comment.parentComment, null);
  });

  it("creates a top-level Comment on a Knowledge article (refType WIKI)", async () => {
    const knowledge = await makeKnowledge();
    const comment = await createComment(fakeActor("USER"), {
      refType: "WIKI",
      refId: knowledge._id,
      body: "Great explanation!",
    });
    assert.equal(comment.refType, "WIKI");
    assert.equal(String(comment.refId), String(knowledge._id));
  });

  it("fails with TARGET_NOT_FOUND when refId does not resolve", async () => {
    await assert.rejects(
      () =>
        createComment(fakeActor("USER"), {
          refType: "ISSUE",
          refId: fakeObjectId(),
          body: "orphan comment",
        }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.TARGET_NOT_FOUND);
        return true;
      },
    );
  });

  it("a valid top-level reply to an existing top-level comment succeeds", async () => {
    const issue = await makeIssue();
    const parent = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "parent comment",
    });
    const reply = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "a reply",
      parentComment: parent._id,
    });
    assert.equal(String(reply.parentComment), String(parent._id));
  });

  it("replying to a reply is rejected (one level of nesting only)", async () => {
    const issue = await makeIssue();
    const parent = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "parent",
    });
    const reply = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "reply",
      parentComment: parent._id,
    });

    await assert.rejects(
      () =>
        createComment(fakeActor("USER"), {
          refType: "ISSUE",
          refId: issue._id,
          body: "reply to a reply",
          parentComment: reply._id,
        }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_PARENT);
        return true;
      },
    );
  });

  it("D-COMMENT-1: a reply targeting a DIFFERENT refId than its parent is rejected", async () => {
    const issueA = await makeIssue();
    const issueB = await makeIssue();
    const parent = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issueA._id,
      body: "parent on issue A",
    });

    await assert.rejects(
      () =>
        createComment(fakeActor("USER"), {
          refType: "ISSUE",
          refId: issueB._id, // different target than the parent
          body: "cross-target reply",
          parentComment: parent._id,
        }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_PARENT);
        return true;
      },
    );
  });

  it("D-COMMENT-1: a reply targeting a DIFFERENT refType than its parent is rejected", async () => {
    const issue = await makeIssue();
    const knowledge = await makeKnowledge();
    const parent = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "parent on an issue",
    });

    await assert.rejects(
      () =>
        createComment(fakeActor("USER"), {
          refType: "WIKI",
          refId: knowledge._id,
          body: "reply pretending to belong to a different refType",
          parentComment: parent._id,
        }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_PARENT);
        return true;
      },
    );
  });

  it("D-COMMENT-1: a reply targeting the SAME (refType, refId) as its parent is accepted", async () => {
    const issue = await makeIssue();
    const parent = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "parent",
    });
    const reply = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id, // same target
      body: "valid same-target reply",
      parentComment: parent._id,
    });
    assert.equal(String(reply.parentComment), String(parent._id));
  });

  it("an unrecognized refType is rejected", async () => {
    const issue = await makeIssue();
    await assert.rejects(
      () =>
        createComment(fakeActor("USER"), {
          refType: "KNOWLEDGE", // not a valid refType — must stay "WIKI"
          refId: issue._id,
          body: "test",
        }),
      (err) => {
        assert.equal(err.code, DomainErrorCode.INVALID_STATE);
        return true;
      },
    );
  });
});

describe("getCommentThread (Issue #48 — public read)", () => {
  it("groups top-level comments with their (at most one level of) replies", async () => {
    const issue = await makeIssue();
    const parentA = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "parent A",
    });
    const parentB = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "parent B",
    });
    const replyToA = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "reply to A",
      parentComment: parentA._id,
    });

    const thread = await getCommentThread("ISSUE", issue._id);
    assert.equal(thread.length, 2);

    const returnedA = thread.find((c) => String(c._id) === String(parentA._id));
    const returnedB = thread.find((c) => String(c._id) === String(parentB._id));
    assert.equal(returnedA.replies.length, 1);
    assert.equal(String(returnedA.replies[0]._id), String(replyToA._id));
    assert.equal(returnedB.replies.length, 0);
  });

  it("orders top-level comments oldest first", async () => {
    const issue = await makeIssue();
    const first = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "first",
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "second",
    });

    const thread = await getCommentThread("ISSUE", issue._id);
    assert.equal(String(thread[0]._id), String(first._id));
    assert.equal(String(thread[1]._id), String(second._id));
  });

  it("returns an empty array for a real target with no comments yet", async () => {
    const issue = await makeIssue();
    const thread = await getCommentThread("ISSUE", issue._id);
    assert.deepEqual(thread, []);
  });

  it("throws TARGET_NOT_FOUND for a well-formed but nonexistent refId", async () => {
    await assert.rejects(
      () => getCommentThread("ISSUE", fakeObjectId()),
      (err) => err.code === DomainErrorCode.TARGET_NOT_FOUND,
    );
  });

  it("throws VALIDATION_FAILED (CastError translation) for a malformed refId", async () => {
    await assert.rejects(
      () => getCommentThread("ISSUE", "not-a-valid-object-id"),
      (err) => err.code === DomainErrorCode.VALIDATION_FAILED,
    );
  });

  it("throws INVALID_STATE for an unrecognized refType", async () => {
    const issue = await makeIssue();
    await assert.rejects(
      () => getCommentThread("KNOWLEDGE", issue._id),
      (err) => err.code === DomainErrorCode.INVALID_STATE,
    );
  });

  it("does not mix comments from a different (refType, refId)", async () => {
    const issueA = await makeIssue();
    const issueB = await makeIssue();
    await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issueA._id,
      body: "belongs to A",
    });
    await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issueB._id,
      body: "belongs to B",
    });

    const threadA = await getCommentThread("ISSUE", issueA._id);
    assert.equal(threadA.length, 1);
    assert.equal(threadA[0].body, "belongs to A");
  });

  it("populates author with name/role only — never email or passwordHash", async () => {
    const user = await User.create({
      name: "Real Commenter",
      email: "commenter@example.com",
      passwordHash: "irrelevant-for-this-test",
      role: "USER",
    });
    const issue = await makeIssue();
    await createComment({ id: String(user._id), role: "USER" }, {
      refType: "ISSUE",
      refId: issue._id,
      body: "hello",
    });

    const thread = await getCommentThread("ISSUE", issue._id);
    assert.equal(thread[0].author.name, "Real Commenter");
    assert.equal(thread[0].author.role, "USER");
    assert.equal(thread[0].author.email, undefined);
    assert.equal(thread[0].author.passwordHash, undefined);
  });

  it("REGRESSION (Issue #48 review): a WIKI thread on a draft Knowledge article is not publicly readable", async () => {
    const draft = await makeKnowledge();
    await createComment(fakeActor("USER"), {
      refType: "WIKI",
      refId: draft._id,
      body: "commenting on a draft",
    });

    await assert.rejects(
      () => getCommentThread("WIKI", draft._id),
      (err) => err.code === DomainErrorCode.TARGET_NOT_FOUND,
    );
  });

  it("REGRESSION (Issue #48 review): a WIKI thread on a pending_review Knowledge article is not publicly readable", async () => {
    const author = fakeActor("USER");
    const pending = await createKnowledge(author, { title: "t", body: "b" });
    await submitForReview(author, pending._id);
    await createComment(author, {
      refType: "WIKI",
      refId: pending._id,
      body: "commenting while pending review",
    });

    await assert.rejects(
      () => getCommentThread("WIKI", pending._id),
      (err) => err.code === DomainErrorCode.TARGET_NOT_FOUND,
    );
  });

  it("REGRESSION (Issue #48 review): a WIKI thread on a rejected Knowledge article is not publicly readable", async () => {
    const author = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    const rejected = await createKnowledge(author, { title: "t", body: "b" });
    await submitForReview(author, rejected._id);
    await reject(expert, rejected._id, "needs work");
    await createComment(author, {
      refType: "WIKI",
      refId: rejected._id,
      body: "commenting on a rejected article",
    });

    await assert.rejects(
      () => getCommentThread("WIKI", rejected._id),
      (err) => err.code === DomainErrorCode.TARGET_NOT_FOUND,
    );
  });

  it("REGRESSION (Issue #48 review): a WIKI thread on an approved Knowledge article IS publicly readable", async () => {
    const author = fakeActor("USER");
    const expert = fakeActor("EXPERT");
    const approved = await createKnowledge(author, { title: "t", body: "b" });
    await submitForReview(author, approved._id);
    await approve(expert, approved._id);
    await createComment(author, {
      refType: "WIKI",
      refId: approved._id,
      body: "commenting on an approved article",
    });

    const thread = await getCommentThread("WIKI", approved._id);
    assert.equal(thread.length, 1);
    assert.equal(thread[0].body, "commenting on an approved article");
  });
});
