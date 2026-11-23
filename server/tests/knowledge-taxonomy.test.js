import assert from "node:assert/strict";
import test from "node:test";

import {
  CATEGORY_ALIASES,
  createKnowledgeTaxonomyResolver,
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

test("production retired registries stay empty until real persisted identities are retired", () => {
  assert.deepEqual(RETIRED_KNOWLEDGE_CATEGORIES, []);
  assert.deepEqual(RETIRED_KNOWLEDGE_TOPICS, []);
});

test("retired fixtures render canonically but cannot be assigned or selected", () => {
  const retiredCategory = Object.freeze({
    slug: "fixture_retired_category",
    displayName: "Fixture retired category",
    status: "RETIRED",
  });
  const retiredTopic = Object.freeze({
    slug: "fixture_retired_topic",
    displayName: "Fixture retired topic",
    status: "RETIRED",
  });
  const resolver = createKnowledgeTaxonomyResolver({
    retiredCategories: [retiredCategory],
    retiredTopics: [retiredTopic],
  });

  assert.equal(resolver.getCategory(retiredCategory.slug), retiredCategory);
  assert.equal(resolver.getCategoryDisplayName(retiredCategory.slug), retiredCategory.displayName);
  assert.equal(resolver.getAssignableCategory(retiredCategory.slug), null);
  assert.equal(resolver.isActiveCategory(retiredCategory.slug), false);
  assert.equal(resolver.getActiveCategories().includes(retiredCategory), false);

  assert.equal(resolver.getTopic(retiredTopic.slug), retiredTopic);
  assert.equal(resolver.getTopicDisplayName(retiredTopic.slug), retiredTopic.displayName);
  assert.equal(resolver.getAssignableTopic(retiredTopic.slug), null);
  assert.equal(resolver.isActiveTopic(retiredTopic.slug), false);
  assert.equal(resolver.getActiveTopics().includes(retiredTopic), false);
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
