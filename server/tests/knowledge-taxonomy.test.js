import assert from "node:assert/strict";
import test from "node:test";

import {
  CATEGORY_ALIASES,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_TOPICS,
  RETIRED_KNOWLEDGE_CATEGORIES,
  RETIRED_KNOWLEDGE_TOPICS,
  TOPIC_ALIASES,
  getActiveCategories,
  getActiveTopics,
  getAssignableCategory,
  getAssignableTopic,
  getCategory,
  getCategoryDisplayName,
  getTopic,
  getTopicDisplayName,
  isActiveCategory,
  isActiveTopic,
} from "../src/domain/knowledge-taxonomy.js";

test("Category and Topic slugs are unique within and across kinds", () => {
  const categorySlugs = KNOWLEDGE_CATEGORIES.map((term) => term.slug);
  const topicSlugs = KNOWLEDGE_TOPICS.map((term) => term.slug);
  assert.equal(new Set(categorySlugs).size, categorySlugs.length);
  assert.equal(new Set(topicSlugs).size, topicSlugs.length);
  assert.equal(new Set([...categorySlugs, ...topicSlugs]).size, categorySlugs.length + topicSlugs.length);
  assert.equal(new Set([...categorySlugs, ...RETIRED_KNOWLEDGE_CATEGORIES.map((term) => term.slug)]).size, categorySlugs.length + RETIRED_KNOWLEDGE_CATEGORIES.length);
  assert.equal(new Set([...topicSlugs, ...RETIRED_KNOWLEDGE_TOPICS.map((term) => term.slug)]).size, topicSlugs.length + RETIRED_KNOWLEDGE_TOPICS.length);
});

test("each term has a stable slug, display name, and valid lifecycle", () => {
  for (const term of [...KNOWLEDGE_CATEGORIES, ...KNOWLEDGE_TOPICS, ...RETIRED_KNOWLEDGE_CATEGORIES, ...RETIRED_KNOWLEDGE_TOPICS]) {
    assert.match(term.slug, /^[a-z0-9]+(?:_[a-z0-9]+)*$/);
    assert.ok(term.displayName.length > 0);
    assert.ok(["ACTIVE", "RETIRED"].includes(term.status));
  }
});

test("all V1 active terms are selectable and assignment-safe", () => {
  assert.deepEqual(getActiveCategories(), KNOWLEDGE_CATEGORIES.filter((term) => term.status === "ACTIVE"));
  assert.deepEqual(getActiveTopics(), KNOWLEDGE_TOPICS.filter((term) => term.status === "ACTIVE"));
  for (const term of getActiveCategories()) assert.equal(getAssignableCategory(term.slug), term);
  for (const term of getActiveTopics()) assert.equal(getAssignableTopic(term.slug), term);
});

test("canonical IDs resolve for rendering and assignment while active", () => {
  assert.equal(getCategory("water_conservation")?.slug, "water_conservation");
  assert.equal(getTopic("rainwater_harvesting")?.slug, "rainwater_harvesting");
  assert.equal(getAssignableCategory("water_conservation")?.slug, "water_conservation");
  assert.equal(getAssignableTopic("rainwater_harvesting")?.slug, "rainwater_harvesting");
});

test("Category aliases are scoped to Category", () => {
  assert.equal(getCategory("Water  Saving")?.slug, "water_conservation");
  assert.equal(getAssignableCategory("water saving")?.slug, "water_conservation");
  assert.equal(getTopic("water saving"), null);
  assert.equal(getAssignableTopic("water saving"), null);
});

test("Topic aliases are scoped to Topic", () => {
  assert.equal(getTopic("RAIN WATER HARVESTING")?.slug, "rainwater_harvesting");
  assert.equal(getAssignableTopic("ground water recharge")?.slug, "groundwater_recharge");
  assert.equal(getCategory("rain water harvesting"), null);
  assert.equal(getAssignableCategory("rain water harvesting"), null);
});

test("alias targets belong to their matching registry, never the other one", () => {
  const categorySlugs = new Set(KNOWLEDGE_CATEGORIES.map((term) => term.slug));
  const topicSlugs = new Set(KNOWLEDGE_TOPICS.map((term) => term.slug));

  for (const [alias, target] of Object.entries(CATEGORY_ALIASES)) {
    assert.notEqual(alias, target);
    assert.equal(categorySlugs.has(target), true, "invalid Category target: " + alias + " -> " + target);
  }
  for (const [alias, target] of Object.entries(TOPIC_ALIASES)) {
    assert.notEqual(alias, target);
    assert.equal(topicSlugs.has(target), true, "invalid Topic target: " + alias + " -> " + target);
  }
});

test("vocabulary does not contain the rejected near-duplicate Topic concepts", () => {
  const topicSlugs = new Set(KNOWLEDGE_TOPICS.map((term) => term.slug));
  assert.equal(topicSlugs.has("water_conservation"), false);
  assert.equal(topicSlugs.has("water_supply_distribution"), false);
  assert.equal(topicSlugs.has("water_quality_monitoring"), true);
  assert.equal(topicSlugs.has("water_distribution_networks"), true);
});

test("retired entries are retained for rendering and excluded from selectable lists", () => {
  assert.equal(RETIRED_KNOWLEDGE_CATEGORIES.length > 0, true);
  assert.equal(RETIRED_KNOWLEDGE_TOPICS.length > 0, true);
  assert.equal(getActiveCategories().some((term) => term.status === "RETIRED"), false);
  assert.equal(getActiveTopics().some((term) => term.status === "RETIRED"), false);

  for (const term of RETIRED_KNOWLEDGE_CATEGORIES) {
    assert.equal(getCategory(term.slug), term);
    assert.equal(getCategoryDisplayName(term.slug), term.displayName);
    assert.equal(getAssignableCategory(term.slug), null);
    assert.equal(isActiveCategory(term.slug), false);
    assert.equal(getActiveCategories().includes(term), false);
  }

  for (const term of RETIRED_KNOWLEDGE_TOPICS) {
    assert.equal(getTopic(term.slug), term);
    assert.equal(getTopicDisplayName(term.slug), term.displayName);
    assert.equal(getAssignableTopic(term.slug), null);
    assert.equal(isActiveTopic(term.slug), false);
    assert.equal(getActiveTopics().includes(term), false);
  }
});

test("null, undefined, non-string, and blank resolver inputs return null", () => {
  const invalid = [null, undefined, 42, {}, [], true, " ", "\t\n"];
  for (const value of invalid) {
    assert.equal(getCategory(value), null);
    assert.equal(getTopic(value), null);
    assert.equal(getAssignableCategory(value), null);
    assert.equal(getAssignableTopic(value), null);
  }
  assert.equal(getCategoryDisplayName(null), null);
  assert.equal(getTopicDisplayName({}), null);
});
