import { describe, it } from "node:test";
import assert from "node:assert/strict";

import mongoose from "mongoose";

import { Knowledge } from "../src/models/Knowledge.js";
import { toPublicKnowledgeDTO } from "../src/services/knowledge.dto.js";

/** #90 — pure (no DB) contract for the public Knowledge shape. */
const doc = {
  _id: "64b7f0c2a1b2c3d4e5f60718",
  title: "T",
  body: "B",
  region: "IN",
  status: "approved",
  author: { _id: "64b7f0c2a1b2c3d4e5f60719", name: "Asha", role: "USER", email: "leak@example.com" },
  reviewHistory: [
    { decision: "rejected", reviewer: "64b7f0c2a1b2c3d4e5f6071a", feedback: "private feedback", timestamp: "t1" },
    { decision: "approved", reviewer: "64b7f0c2a1b2c3d4e5f6071b", timestamp: "t2" },
  ],
  createdAt: "c",
  updatedAt: "u",
  __v: 3,
};

describe("toPublicKnowledgeDTO", () => {
  it("keeps the established public shape", () => {
    const dto = toPublicKnowledgeDTO(doc);
    assert.deepEqual(Object.keys(dto).sort(), [
      "_id", "author", "body", "createdAt", "region", "reviewHistory", "status", "title", "updatedAt",
    ]);
    assert.deepEqual(dto.author, { _id: doc.author._id, name: "Asha", role: "USER" });
    assert.equal(dto.reviewHistory[1].reviewer, "64b7f0c2a1b2c3d4e5f6071b");
  });

  it("never exposes moderation feedback, extra author fields, or storage internals", () => {
    const dto = toPublicKnowledgeDTO(doc);
    assert.ok(!JSON.stringify(dto).includes("private feedback"));
    assert.ok(!JSON.stringify(dto).includes("leak@example.com"));
    assert.equal("__v" in dto, false);
    for (const e of dto.reviewHistory) assert.deepEqual(Object.keys(e).sort(), ["decision", "reviewer", "timestamp"]);
  });

  it("tolerates a missing/deleted author", () => {
    assert.equal(toPublicKnowledgeDTO({ ...doc, author: null }).author, null);
  });

  it("absent or empty reviewHistory maps to []", () => {
    const noHistory = { ...doc };
    delete noHistory.reviewHistory;
    assert.deepEqual(toPublicKnowledgeDTO(noHistory).reviewHistory, []);
    assert.deepEqual(toPublicKnowledgeDTO({ ...doc, reviewHistory: [] }).reviewHistory, []);
  });

  it("accepts a real Mongoose document: ObjectId reviewers become strings, feedback is dropped", () => {
    const reviewer = new mongoose.Types.ObjectId();
    const k = new Knowledge({
      title: "T",
      body: "B",
      status: "approved",
      author: new mongoose.Types.ObjectId(),
      reviewHistory: [
        { decision: "rejected", reviewer, feedback: "private feedback", timestamp: new Date(1) },
        { decision: "approved", reviewer, timestamp: new Date(2) },
      ],
    });
    // Simulate a populated author, as the public reads do.
    k.author = { _id: new mongoose.Types.ObjectId(), name: "Asha", role: "USER", email: "leak@example.com" };
    const dto = toPublicKnowledgeDTO(k);
    assert.equal(typeof dto._id, "string");
    assert.equal(dto.reviewHistory.length, 2);
    for (const e of dto.reviewHistory) {
      assert.equal(e.reviewer, String(reviewer));
      assert.deepEqual(Object.keys(e).sort(), ["decision", "reviewer", "timestamp"]);
    }
    assert.ok(!JSON.stringify(dto).includes("private feedback"));
    assert.ok(!JSON.stringify(dto).includes("leak@example.com"));
    assert.equal("__v" in dto, false);
  });
});
