import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { createApp } from "../src/app.js";
import { Discussion } from "../src/models/Discussion.js";
import { User } from "../src/models/User.js";
import { createDiscussion } from "../src/services/discussion.service.js";
import { createComment } from "../src/services/comment.service.js";
import {
  clearCollections,
  setupTestDb,
  teardownTestDb,
} from "./helpers/testDb.js";

before(setupTestDb);
after(teardownTestDb);
beforeEach(async () => {
  await clearCollections();
  await Discussion.deleteMany({});
});

function requestWithQuery(query = {}) {
  return request(createApp()).get("/api/v1/community/activity").query(query);
}

async function makeUser() {
  return User.create({
    name: "Route User",
    email: Date.now() + "-" + Math.random() + "@example.com",
    passwordHash: "test-hash",
    role: "USER",
  });
}

describe("GET /api/v1/community/activity", () => {
  it("is public and returns the shared pagination envelope", async () => {
    const user = await makeUser();
    const discussion = await createDiscussion(
      { id: String(user._id), role: "USER" },
      { title: "Public discussion", body: "body", category: "QUESTION" },
    );

    await createComment(
      { id: String(user._id), role: "USER" },
      {
        refType: "DISCUSSION",
        refId: String(discussion._id),
        body: "hello",
      },
    );

    const response = await requestWithQuery({ page: 1, limit: 20 });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.page, 1);
    assert.equal(response.body.data.limit, 20);
    assert.equal(response.body.data.total, 1);
    assert.equal(response.body.data.items[0].type, "DISCUSSION");
    assert.equal(
      response.body.data.items[0].resource.id,
      String(discussion._id),
    );
  });

  it("rejects malformed pagination values", async () => {
    const response = await requestWithQuery({ page: "nope" });

    assert.equal(response.status, 400);
    assert.equal(response.body.code, "VALIDATION_FAILED");
  });

  it("does not expose hidden Discussions", async () => {
    const user = await makeUser();
    const hidden = await createDiscussion(
      { id: String(user._id), role: "USER" },
      { title: "Hidden discussion", body: "body", category: "QUESTION" },
    );

    await Discussion.updateOne(
      { _id: hidden._id },
      { $set: { status: "HIDDEN" } },
    );

    const response = await requestWithQuery();

    assert.equal(response.status, 200);
    assert.equal(response.body.data.total, 0);
    assert.deepEqual(response.body.data.items, []);
  });
});
