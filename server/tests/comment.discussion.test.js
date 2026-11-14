import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Discussion } from "../src/models/Discussion.js";
import { createDiscussion } from "../src/services/discussion.service.js";
import {
  createComment,
  getCommentThread,
} from "../src/services/comment.service.js";
import { DomainErrorCode } from "../src/services/errors.js";
import {
  setupTestDb,
  teardownTestDb,
  clearCollections,
  fakeActor,
} from "./helpers/testDb.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(async () => {
  await clearCollections();
  await Discussion.deleteMany({});
});

async function makeDiscussion(status = "ACTIVE") {
  const discussion = await createDiscussion(fakeActor("USER"), {
    title: "Groundwater testing",
    body: "Where can we get groundwater tested?",
    category: "QUESTION",
  });

  if (status !== "ACTIVE") {
    await Discussion.updateOne(
      { _id: discussion._id },
      { $set: { status } },
    );
  }

  return Discussion.findById(discussion._id);
}

describe("Comment DISCUSSION target support", () => {
  it("creates a top-level Comment on a Discussion", async () => {
    const discussion = await makeDiscussion();
    const comment = await createComment(fakeActor("USER"), {
      refType: "DISCUSSION",
      refId: discussion._id,
      body: "The district lab accepts these samples.",
    });

    assert.equal(comment.refType, "DISCUSSION");
    assert.equal(String(comment.refId), String(discussion._id));
    assert.equal(comment.parentComment, null);
  });

  it("rejects creation when the target Discussion is HIDDEN", async () => {
    const discussion = await makeDiscussion("HIDDEN");

    await assert.rejects(
      () =>
        createComment(fakeActor("USER"), {
          refType: "DISCUSSION",
          refId: discussion._id,
          body: "this must not be added to a hidden Discussion",
        }),
      (err) => err.code === DomainErrorCode.TARGET_NOT_FOUND,
    );
  });

  it("accepts a reply on the same Discussion target", async () => {
    const discussion = await makeDiscussion();
    const parent = await createComment(fakeActor("USER"), {
      refType: "DISCUSSION",
      refId: discussion._id,
      body: "I have used the district lab.",
    });

    const reply = await createComment(fakeActor("USER"), {
      refType: "DISCUSSION",
      refId: discussion._id,
      body: "Thanks, that helps.",
      parentComment: parent._id,
    });

    assert.equal(String(reply.parentComment), String(parent._id));
    assert.equal(reply.refType, "DISCUSSION");
    assert.equal(String(reply.refId), String(discussion._id));
  });

  it("rejects a cross-target reply between Discussions", async () => {
    const discussionA = await makeDiscussion();
    const discussionB = await makeDiscussion();

    const parent = await createComment(fakeActor("USER"), {
      refType: "DISCUSSION",
      refId: discussionA._id,
      body: "parent",
    });

    await assert.rejects(
      () =>
        createComment(fakeActor("USER"), {
          refType: "DISCUSSION",
          refId: discussionB._id,
          body: "cross-target reply",
          parentComment: parent._id,
        }),
      (err) => err.code === DomainErrorCode.INVALID_PARENT,
    );
  });

  it("rejects a reply to an ISSUE comment from a DISCUSSION target", async () => {
    const { createIssue } = await import("../src/services/issue.service.js");
    const issue = await createIssue(fakeActor("USER"), {
      title: "Leaking pipe",
      description: "d",
      location: { type: "Point", coordinates: [77.5, 12.9] },
    });
    const discussion = await makeDiscussion();

    const parent = await createComment(fakeActor("USER"), {
      refType: "ISSUE",
      refId: issue._id,
      body: "Issue comment",
    });

    await assert.rejects(
      () =>
        createComment(fakeActor("USER"), {
          refType: "DISCUSSION",
          refId: discussion._id,
          body: "wrong target type",
          parentComment: parent._id,
        }),
      (err) => err.code === DomainErrorCode.INVALID_PARENT,
    );
  });

  it("preserves the one-level reply invariant for Discussion comments", async () => {
    const discussion = await makeDiscussion();
    const parent = await createComment(fakeActor("USER"), {
      refType: "DISCUSSION",
      refId: discussion._id,
      body: "parent",
    });
    const reply = await createComment(fakeActor("USER"), {
      refType: "DISCUSSION",
      refId: discussion._id,
      body: "reply",
      parentComment: parent._id,
    });

    await assert.rejects(
      () =>
        createComment(fakeActor("USER"), {
          refType: "DISCUSSION",
          refId: discussion._id,
          body: "reply to reply",
          parentComment: reply._id,
        }),
      (err) => err.code === DomainErrorCode.INVALID_PARENT,
    );
  });
});

describe("public Discussion Comment reads", () => {
  it("returns a Discussion thread anonymously when the Discussion is ACTIVE", async () => {
    const discussion = await makeDiscussion();
    await createComment(fakeActor("USER"), {
      refType: "DISCUSSION",
      refId: discussion._id,
      body: "public discussion comment",
    });

    const thread = await getCommentThread("DISCUSSION", discussion._id);
    assert.equal(thread.length, 1);
    assert.equal(thread[0].refType, "DISCUSSION");
    assert.equal(thread[0].body, "public discussion comment");
  });

  it("hides an existing Discussion thread after the target becomes HIDDEN", async () => {
    const discussion = await makeDiscussion("ACTIVE");
    await createComment(fakeActor("USER"), {
      refType: "DISCUSSION",
      refId: discussion._id,
      body: "comment while the Discussion is public",
    });

    await Discussion.updateOne(
      { _id: discussion._id },
      { $set: { status: "HIDDEN" } },
    );

    await assert.rejects(
      () => getCommentThread("DISCUSSION", discussion._id),
      (err) => err.code === DomainErrorCode.TARGET_NOT_FOUND,
    );
  });

  it("uses the same public boundary for a nonexistent Discussion", async () => {
    await assert.rejects(
      () =>
        getCommentThread(
          "DISCUSSION",
          "507f1f77bcf86cd799439011",
        ),
      (err) => err.code === DomainErrorCode.TARGET_NOT_FOUND,
    );
  });
});
