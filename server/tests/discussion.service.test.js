import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Discussion } from "../src/models/Discussion.js";
import {
  createDiscussion,
  getPublicDiscussionById,
  listPublicDiscussions,
} from "../src/services/discussion.service.js";
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
});

describe("Discussion persistence contract", () => {
  it("declares the required public status/creation ordering index", () => {
    const indexes = Discussion.schema.indexes();
    assert.ok(
      indexes.some(
        ([fields]) =>
          fields.status === 1 &&
          fields.createdAt === -1 &&
          fields._id === -1,
      ),
      "Discussion must declare { status: 1, createdAt: -1, _id: -1 }",
    );
  });
});

describe("createDiscussion", () => {
  it("creates an ACTIVE Discussion owned by the authenticated actor", async () => {
    const actor = fakeActor("USER");
    const discussion = await createDiscussion(actor, {
      title: "Recurring water shortages",
      body: "Is anyone else seeing this every week?",
      category: "QUESTION",
    });

    assert.equal(discussion.status, "ACTIVE");
    assert.equal(String(discussion.author), actor.id);
    assert.equal(discussion.category, "QUESTION");
    assert.equal(discussion.title, "Recurring water shortages");
  });

  it("allows USER, EXPERT and ADMIN actors to create", async () => {
    for (const role of ["USER", "EXPERT", "ADMIN"]) {
      const discussion = await createDiscussion(fakeActor(role), {
        title: role + " discussion",
        body: "body",
        category: "DISCUSSION",
      });
      assert.equal(discussion.status, "ACTIVE");
    }
  });

  it("rejects anonymous creation server-side", async () => {
    await assert.rejects(
      () =>
        createDiscussion(null, {
          title: "x",
          body: "y",
          category: "QUESTION",
        }),
      (err) => err.code === DomainErrorCode.UNAUTHORIZED,
    );
  });

  it("rejects invalid category and empty content even when called without the HTTP schema", async () => {
    for (const payload of [
      { title: "x", body: "y", category: "NOT_REAL" },
      { title: "   ", body: "y", category: "QUESTION" },
      { title: "x", body: "   ", category: "QUESTION" },
    ]) {
      await assert.rejects(
        () => createDiscussion(fakeActor(), payload),
        (err) => err.code === DomainErrorCode.VALIDATION_FAILED,
      );
    }
  });
});

describe("public Discussion reads", () => {
  it("returns only ACTIVE Discussions, newest first with _id tie-breaker", async () => {
    const author = fakeActor();
    const first = await createDiscussion(author, {
      title: "first",
      body: "body",
      category: "DISCUSSION",
    });
    const second = await createDiscussion(author, {
      title: "second",
      body: "body",
      category: "IDEA",
    });

    const hidden = await Discussion.create({
      title: "hidden",
      body: "private",
      category: "QUESTION",
      status: "HIDDEN",
      author: author.id,
    });

    await Discussion.updateOne(
      { _id: second._id },
      { $set: { createdAt: first.createdAt } },
    );

    const result = await listPublicDiscussions({ page: 1, limit: 20 });
    const ids = result.items.map((item) => String(item._id));

    assert.equal(result.total, 2);
    assert.equal(result.totalPages, 1);
    assert.deepEqual(ids, [String(second._id), String(first._id)]);
    assert.ok(!ids.includes(String(hidden._id)));
  });

  it("paginates deterministically and returns the shared V2 envelope shape", async () => {
    const actor = fakeActor();
    for (let i = 0; i < 3; i++) {
      await createDiscussion(actor, {
        title: "discussion-" + i,
        body: "body",
        category: "QUESTION",
      });
    }

    const page = await listPublicDiscussions({ page: 2, limit: 2 });
    assert.equal(page.items.length, 1);
    assert.equal(page.page, 2);
    assert.equal(page.limit, 2);
    assert.equal(page.total, 3);
    assert.equal(page.totalPages, 2);
  });

  it("returns NOT_FOUND for a hidden Discussion without revealing its status", async () => {
    const hidden = await Discussion.create({
      title: "hidden",
      body: "secret",
      category: "IDEA",
      status: "HIDDEN",
      author: fakeActor().id,
    });

    await assert.rejects(
      () => getPublicDiscussionById(hidden._id),
      (err) => err.code === DomainErrorCode.NOT_FOUND,
    );
  });

  it("returns NOT_FOUND for a well-formed nonexistent id", async () => {
    await assert.rejects(
      () => getPublicDiscussionById(fakeObjectId()),
      (err) => err.code === DomainErrorCode.NOT_FOUND,
    );
  });

  it("translates malformed ids to VALIDATION_FAILED", async () => {
    await assert.rejects(
      () => getPublicDiscussionById("not-a-valid-object-id"),
      (err) => err.code === DomainErrorCode.VALIDATION_FAILED,
    );
  });
});
