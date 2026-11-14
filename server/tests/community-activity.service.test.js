import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Comment } from "../src/models/Comment.js";
import { Discussion } from "../src/models/Discussion.js";
import { User } from "../src/models/User.js";
import { listCommunityActivity } from "../src/services/community-activity.service.js";
import { createDiscussion } from "../src/services/discussion.service.js";
import { createIssue } from "../src/services/issue.service.js";
import {
  createKnowledge,
  submitForReview,
  approve,
} from "../src/services/knowledge.service.js";
import { createComment } from "../src/services/comment.service.js";
import {
  setupTestDb,
  teardownTestDb,
  clearCollections,
  fakeActor,
  validPoint,
} from "./helpers/testDb.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(async () => {
  await clearCollections();
  await Discussion.deleteMany({});
});

async function makeUser({ name = "Activity User", role = "USER" } = {}) {
  return User.create({
    name,
    email: Date.now() + "-" + Math.random() + "@example.com",
    passwordHash: "test-hash",
    role,
  });
}

async function makeDiscussion(authorId, title) {
  return createDiscussion(
    { id: String(authorId), role: "USER" },
    { title, body: "body", category: "DISCUSSION" },
  );
}

async function makeIssue(reporterId, title) {
  return createIssue(
    { id: String(reporterId), role: "USER" },
    {
      title,
      description: "description",
      location: validPoint(),
    },
  );
}

async function makeApprovedKnowledge(authorId, title) {
  const knowledge = await createKnowledge(
    { id: String(authorId), role: "USER" },
    { title, body: "body" },
  );
  await submitForReview(
    { id: String(authorId), role: "USER" },
    knowledge._id,
  );
  return approve(fakeActor("EXPERT"), knowledge._id);
}

async function addComment(refType, refId, authorId, body = "comment") {
  return createComment(
    { id: String(authorId), role: "USER" },
    { refType, refId: String(refId), body },
  );
}

describe("listCommunityActivity", () => {
  it("projects Discussion, Issue, and approved Knowledge activity", async () => {
    const author = await makeUser({ name: "Public Author" });
    const discussion = await makeDiscussion(author._id, "Discussion title");
    const issue = await makeIssue(author._id, "Issue title");
    const knowledge = await makeApprovedKnowledge(author._id, "Knowledge title");

    await addComment("DISCUSSION", discussion._id, author._id);
    await addComment("ISSUE", issue._id, author._id);
    await addComment("WIKI", knowledge._id, author._id);

    const result = await listCommunityActivity();
    assert.equal(result.total, 3);
    assert.equal(result.items.length, 3);

    const byType = Object.fromEntries(
      result.items.map((item) => [item.type, item]),
    );

    assert.equal(byType.DISCUSSION.resource.type, "DISCUSSION");
    assert.equal(byType.DISCUSSION.resource.id, String(discussion._id));
    assert.equal(byType.ISSUE.resource.type, "ISSUE");
    assert.equal(byType.ISSUE.resource.id, String(issue._id));
    assert.equal(byType.KNOWLEDGE.resource.type, "KNOWLEDGE");
    assert.equal(byType.KNOWLEDGE.resource.id, String(knowledge._id));
    assert.equal(byType.DISCUSSION.commentCount, 1);
    assert.equal(byType.ISSUE.commentCount, 1);
    assert.equal(byType.KNOWLEDGE.commentCount, 1);
  });

  it("uses Discussion creation time without comments and excludes Issue/Knowledge without comments", async () => {
    const author = await makeUser();
    const discussion = await makeDiscussion(author._id, "No comments");
    await makeIssue(author._id, "No issue comments");
    await makeApprovedKnowledge(author._id, "No knowledge comments");

    const result = await listCommunityActivity();

    assert.equal(result.total, 1);
    assert.equal(result.items[0].type, "DISCUSSION");
    assert.equal(result.items[0].commentCount, 0);
    assert.equal(
      new Date(result.items[0].activityAt).getTime(),
      new Date(discussion.createdAt).getTime(),
    );
  });

  it("excludes hidden Discussions and non-approved Knowledge", async () => {
    const author = await makeUser();
    const hiddenDiscussion = await makeDiscussion(author._id, "Hidden");
    await Discussion.updateOne(
      { _id: hiddenDiscussion._id },
      { $set: { status: "HIDDEN" } },
    );

    const draft = await createKnowledge(
      { id: String(author._id), role: "USER" },
      { title: "Draft", body: "body" },
    );
    await addComment("WIKI", draft._id, author._id);

    const active = await makeDiscussion(author._id, "Visible");
    await addComment("DISCUSSION", active._id, author._id);

    const result = await listCommunityActivity();
    const titles = result.items.map((item) => item.title);

    assert.deepEqual(titles, ["Visible"]);
    assert.equal(result.total, 1);
  });

  it("uses latest comment time for ordering and counts all comments", async () => {
    const author = await makeUser();
    const older = await makeDiscussion(author._id, "Older");
    const newer = await makeDiscussion(author._id, "Newer");

    const olderFirst = await addComment("DISCUSSION", older._id, author._id, "first");
    const newerComment = await addComment("DISCUSSION", newer._id, author._id, "newer");
    const olderLatest = await addComment("DISCUSSION", older._id, author._id, "latest");

    const firstTime = new Date("2026-01-01T00:00:00.000Z");
    const newerTime = new Date("2026-01-02T00:00:00.000Z");
    const latestTime = new Date("2026-01-03T00:00:00.000Z");

    await Comment.updateOne(
      { _id: olderFirst._id },
      { $set: { createdAt: firstTime, updatedAt: firstTime } },
    );
    await Comment.updateOne(
      { _id: newerComment._id },
      { $set: { createdAt: newerTime, updatedAt: newerTime } },
    );
    await Comment.updateOne(
      { _id: olderLatest._id },
      { $set: { createdAt: latestTime, updatedAt: latestTime } },
    );

    const result = await listCommunityActivity();

    assert.deepEqual(
      result.items.map((item) => item.title),
      ["Older", "Newer"],
    );
    assert.equal(result.items[0].commentCount, 2);
    assert.equal(
      new Date(result.items[0].activityAt).getTime(),
      latestTime.getTime(),
    );
    assert.equal(
      new Date(result.items[1].activityAt).getTime(),
      newerTime.getTime(),
    );
  });

  it("uses deterministic sourceType/resourceObjectId tie-breakers", async () => {
    const author = await makeUser();
    const discussion = await makeDiscussion(author._id, "Discussion");
    const issue = await makeIssue(author._id, "Issue");

    await addComment("DISCUSSION", discussion._id, author._id);
    await addComment("ISSUE", issue._id, author._id);

    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    await Discussion.updateOne(
      { _id: discussion._id },
      { $set: { createdAt: timestamp } },
    );
    await Issue.updateOne(
      { _id: issue._id },
      { $set: { createdAt: timestamp } },
    );
    await Comment.updateMany(
      { refId: { $in: [discussion._id, issue._id] } },
      { $set: { createdAt: timestamp, updatedAt: timestamp } },
    );

    // The source-type key must win before the ObjectId key, even when the
    // Issue has a deliberately lower resource ObjectId.
    const result = await listCommunityActivity();

    assert.equal(result.total, 2);
    assert.equal(result.items[0].type, "DISCUSSION");
    assert.equal(result.items[1].type, "ISSUE");
    assert.equal(result.items[0].activityAt, timestamp.toISOString());
    assert.equal(result.items[1].activityAt, timestamp.toISOString());
  });

  it("paginates the globally sorted projection instead of fixed per-source slices", async () => {
    const author = await makeUser();

    for (let i = 0; i < 3; i += 1) {
      const discussion = await makeDiscussion(author._id, "D" + i);
      await addComment("DISCUSSION", discussion._id, author._id);
    }

    const issue = await makeIssue(author._id, "Issue");
    await addComment("ISSUE", issue._id, author._id);

    const page1 = await listCommunityActivity({ page: 1, limit: 2 });
    const page2 = await listCommunityActivity({ page: 2, limit: 2 });

    assert.equal(page1.total, 4);
    assert.equal(page2.total, 4);
    assert.equal(page1.items.length, 2);
    assert.equal(page2.items.length, 2);

    const ids = [...page1.items, ...page2.items].map((item) => item.id);
    assert.equal(new Set(ids).size, 4);
  });

  it("allowlists public actor fields", async () => {
    const author = await makeUser({ name: "Private Fields" });
    const discussion = await makeDiscussion(author._id, "Privacy");
    const result = await listCommunityActivity();

    assert.equal(result.items[0].author.name, "Private Fields");
    assert.equal(result.items[0].author.role, "USER");
    assert.equal(result.items[0].author.email, undefined);
    assert.equal(result.items[0].author.passwordHash, undefined);
    assert.equal(result.items[0].author._id, String(author._id));
    assert.equal(result.items[0].resource.id, String(discussion._id));
  });
});
