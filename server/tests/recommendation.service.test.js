import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Issue } from "../src/models/Issue.js";
import { createIssue } from "../src/services/issue.service.js";
import { getRecommendationsForIssue } from "../src/services/recommendation.service.js";
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

async function makeIssue(classification = {}) {
  return createIssue(fakeActor(), {
    title: "Water issue",
    description: "Reported near the market",
    location: validPoint(),
    ...classification,
  });
}

describe("recommendation.service — getRecommendationsForIssue", () => {
  it("returns deterministic category and severity recommendations", async () => {
    const issue = await makeIssue({
      category: "leakage_wastage",
      severity: "high",
    });

    const first = await getRecommendationsForIssue(issue._id);
    const second = await getRecommendationsForIssue(issue._id);

    assert.deepEqual(first, second);
    assert.equal(first.contextStatus, "classified");
    assert.deepEqual(
      first.recommendations.map(({ id }) => id),
      ["leakage-wastage", "high-severity-escalation"],
    );
    for (const recommendation of first.recommendations) {
      assert.ok(recommendation.suggestion.length > 0);
      assert.ok(recommendation.reason.length > 0);
    }
  });

  it("has a category rule for every actionable canonical category", async () => {
    const categories = [
      "supply_shortage",
      "leakage_wastage",
      "water_quality",
      "flooding_drainage",
      "damaged_infrastructure",
    ];

    for (const category of categories) {
      const issue = await makeIssue({ category });
      const result = await getRecommendationsForIssue(issue._id);
      assert.ok(result.recommendations.length > 0, category);
      assert.match(result.recommendations[0].reason, new RegExp(category));
    }
  });

  it("returns insufficient_context without inventing guidance", async () => {
    const issue = await makeIssue();

    assert.deepEqual(await getRecommendationsForIssue(issue._id), {
      issueId: String(issue._id),
      contextStatus: "insufficient_context",
      recommendations: [],
    });
  });

  it("returns no recommendations when a valid context matches no rule", async () => {
    const issue = await makeIssue({ category: "other", severity: "low" });

    assert.deepEqual(await getRecommendationsForIssue(issue._id), {
      issueId: String(issue._id),
      contextStatus: "classified",
      recommendations: [],
    });
  });

  it("uses a severity rule when the category is unclassified", async () => {
    const issue = await makeIssue({ severity: "critical" });
    const result = await getRecommendationsForIssue(issue._id);

    assert.deepEqual(
      result.recommendations.map(({ id }) => id),
      ["high-severity-escalation"],
    );
  });

  it("throws NOT_FOUND for a well-formed, missing Issue", async () => {
    await assert.rejects(
      () => getRecommendationsForIssue(fakeObjectId()),
      (err) => err.code === DomainErrorCode.NOT_FOUND,
    );
  });

  it("throws VALIDATION_FAILED for a malformed Issue id", async () => {
    await assert.rejects(
      () => getRecommendationsForIssue("not-a-valid-object-id"),
      (err) => err.code === DomainErrorCode.VALIDATION_FAILED,
    );
  });

  it("does not persist recommendations", async () => {
    const issue = await makeIssue({ category: "water_quality" });
    await getRecommendationsForIssue(issue._id);

    const stored = await Issue.findById(issue._id).lean();
    assert.equal(stored.recommendations, undefined);
  });
});
