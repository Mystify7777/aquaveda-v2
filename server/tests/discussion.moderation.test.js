import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Discussion } from "../src/models/Discussion.js";
import { DiscussionReport } from "../src/models/DiscussionReport.js";
import { createDiscussion } from "../src/services/discussion.service.js";
import {
  hideDiscussion,
  listDiscussionReports,
  reportDiscussion,
  unhideDiscussion,
} from "../src/services/discussion-moderation.service.js";
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
beforeEach(async () => {
  await clearCollections();
  await Discussion.deleteMany({});
  await DiscussionReport.deleteMany({});
});

async function makeDiscussion(author = fakeActor("USER")) {
  return createDiscussion(author, {
    title: "Groundwater testing",
    body: "Where can we get groundwater tested?",
    category: "QUESTION",
  });
}

describe("DiscussionReport persistence contract", () => {
  it("declares the unique reporter-per-Discussion index", () => {
    const indexes = DiscussionReport.schema.indexes();
    assert.ok(
      indexes.some(
        ([fields, options]) =>
          fields.discussion === 1 &&
          fields.reporter === 1 &&
          options?.unique === true,
      ),
      "DiscussionReport must declare unique { discussion: 1, reporter: 1 }",
    );
  });
});

describe("reportDiscussion", () => {
  it("accepts one private report from an authenticated non-author", async () => {
    const discussion = await makeDiscussion();
    const reporter = fakeActor("USER");

    const report = await reportDiscussion(
      reporter,
      discussion._id,
      "SPAM",
    );

    assert.equal(String(report.discussion), String(discussion._id));
    assert.equal(String(report.reporter), reporter.id);
    assert.equal(report.reason, "SPAM");
    assert.ok(report.createdAt);
  });

  it("rejects anonymous reporting", async () => {
    const discussion = await makeDiscussion();

    await assert.rejects(
      () => reportDiscussion(null, discussion._id, "SPAM"),
      (err) => err.code === DomainErrorCode.UNAUTHORIZED,
    );
  });

  it("rejects self-reporting", async () => {
    const author = fakeActor("USER");
    const discussion = await makeDiscussion(author);

    await assert.rejects(
      () => reportDiscussion(author, discussion._id, "SPAM"),
      (err) => err.code === DomainErrorCode.FORBIDDEN,
    );
  });

  it("rejects duplicate reports from the same reporter", async () => {
    const discussion = await makeDiscussion();
    const reporter = fakeActor("USER");

    await reportDiscussion(reporter, discussion._id, "SPAM");

    await assert.rejects(
      () => reportDiscussion(reporter, discussion._id, "MISLEADING"),
      (err) => err.code === DomainErrorCode.INVALID_STATE,
    );
  });

  it("rejects reports for hidden or nonexistent Discussions", async () => {
    const discussion = await makeDiscussion();
    await Discussion.updateOne(
      { _id: discussion._id },
      { $set: { status: "HIDDEN" } },
    );

    await assert.rejects(
      () => reportDiscussion(fakeActor("USER"), discussion._id, "SPAM"),
      (err) => err.code === DomainErrorCode.NOT_FOUND,
    );

    await assert.rejects(
      () => reportDiscussion(fakeActor("USER"), fakeObjectId(), "SPAM"),
      (err) => err.code === DomainErrorCode.NOT_FOUND,
    );
  });

  it("rejects invalid report reasons", async () => {
    const discussion = await makeDiscussion();

    await assert.rejects(
      () => reportDiscussion(fakeActor("USER"), discussion._id, "NOT_A_REASON"),
      (err) => err.code === DomainErrorCode.VALIDATION_FAILED,
    );
  });
});

describe("Discussion visibility moderation", () => {
  it("allows an author to self-hide without a moderation reason", async () => {
    const author = fakeActor("USER");
    const discussion = await makeDiscussion(author);

    const hidden = await hideDiscussion(author, discussion._id);

    assert.equal(hidden.status, "HIDDEN");
    assert.equal(hidden.moderationHistory.length, 1);
    assert.equal(hidden.moderationHistory[0].action, "AUTHOR_HIDDEN");
    assert.equal(hidden.moderationHistory[0].fromStatus, "ACTIVE");
    assert.equal(hidden.moderationHistory[0].toStatus, "HIDDEN");
    assert.equal(hidden.moderationHistory[0].reason, null);
  });

  it("rejects a non-author USER and EXPERT from hiding another user's Discussion", async () => {
    const author = fakeActor("USER");
    const discussion = await makeDiscussion(author);

    for (const actor of [fakeActor("USER"), fakeActor("EXPERT")]) {
      await assert.rejects(
        () => hideDiscussion(actor, discussion._id),
        (err) => err.code === DomainErrorCode.FORBIDDEN,
      );
    }
  });

  it("allows ADMIN to hide any active Discussion and records a reason", async () => {
    const discussion = await makeDiscussion();
    const admin = fakeActor("ADMIN");

    const hidden = await hideDiscussion(
      admin,
      discussion._id,
      "Violates Community content policy",
    );

    assert.equal(hidden.status, "HIDDEN");
    assert.equal(hidden.moderationHistory.length, 1);
    assert.equal(hidden.moderationHistory[0].action, "ADMIN_HIDDEN");
    assert.equal(hidden.moderationHistory[0].reason, "Violates Community content policy");
  });

  it("requires a reason for ADMIN hide and rejects repeat hide", async () => {
    const discussion = await makeDiscussion();
    const admin = fakeActor("ADMIN");

    await assert.rejects(
      () => hideDiscussion(admin, discussion._id),
      (err) => err.code === DomainErrorCode.VALIDATION_FAILED,
    );

    await hideDiscussion(admin, discussion._id, "Policy violation");

    await assert.rejects(
      () => hideDiscussion(admin, discussion._id, "Again"),
      (err) => err.code === DomainErrorCode.STATE_RACE,
    );
  });

  it("allows only ADMIN to unhide and requires a reason", async () => {
    const discussion = await makeDiscussion();
    const author = fakeActor("USER");
    const admin = fakeActor("ADMIN");

    await hideDiscussion(admin, discussion._id, "Policy violation");

    await assert.rejects(
      () => unhideDiscussion(author, discussion._id, "Restore"),
      (err) => err.code === DomainErrorCode.FORBIDDEN,
    );

    const restored = await unhideDiscussion(
      admin,
      discussion._id,
      "Review completed; content restored",
    );

    assert.equal(restored.status, "ACTIVE");
    assert.equal(restored.moderationHistory.length, 2);
    assert.equal(restored.moderationHistory[1].action, "ADMIN_UNHIDDEN");
    assert.equal(restored.moderationHistory[1].fromStatus, "HIDDEN");
    assert.equal(restored.moderationHistory[1].toStatus, "ACTIVE");
  });

  it("rejects unhide on an already active Discussion", async () => {
    const discussion = await makeDiscussion();
    const admin = fakeActor("ADMIN");

    await assert.rejects(
      () => unhideDiscussion(admin, discussion._id, "Already public"),
      (err) => err.code === DomainErrorCode.STATE_RACE,
    );
  });
});

describe("listDiscussionReports", () => {
  it("is ADMIN-only and returns private report evidence", async () => {
    const discussion = await makeDiscussion();
    await reportDiscussion(fakeActor("USER"), discussion._id, "MISLEADING");

    const adminResult = await listDiscussionReports(fakeActor("ADMIN"), {
      page: 1,
      limit: 20,
    });

    assert.equal(adminResult.total, 1);
    assert.equal(adminResult.items.length, 1);
    assert.equal(adminResult.items[0].reason, "MISLEADING");
    assert.equal(String(adminResult.items[0].discussion._id), String(discussion._id));
  });

  it("rejects non-ADMIN report review", async () => {
    await assert.rejects(
      () => listDiscussionReports(fakeActor("EXPERT"), { page: 1, limit: 20 }),
      (err) => err.code === DomainErrorCode.FORBIDDEN,
    );
  });
});
