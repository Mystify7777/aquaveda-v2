import assert from "node:assert/strict";
import test from "node:test";

import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_TOPICS,
  TAXONOMY_ALIASES,
  getActiveCategories,
  getActiveTopics,
  getCategory,
  getRetiredTaxonomyTerms,
  getTopic,
  isActiveCategory,
  isActiveTaxonomyTerm,
  isActiveTopic,
} from "../src/domain/knowledge-taxonomy.js";

test("category and topic slugs are unique and stable", () => {
  assert.equal(new Set(KNOWLEDGE_CATEGORIES.map((term) => term.slug)).size, KNOWLEDGE_CATEGORIES.length);
  assert.equal(new Set(KNOWLEDGE_TOPICS.map((term) => term.slug)).size, KNOWLEDGE_TOPICS.length);

  for (const term of [...KNOWLEDGE_CATEGORIES, ...KNOWLEDGE_TOPICS]) {
    assert.match(term.slug, /^[a-z0-9]+(?:_[a-z0-9]+)*$/);
    assert.ok(term.displayName.length > 0);
    assert.ok(["ACTIVE", "RETIRED"].includes(term.status));
  }
});

test("all initial V1 terms are active and selectable", () => {
  assert.equal(getActiveCategories().length, KNOWLEDGE_CATEGORIES.length);
  assert.equal(getActiveTopics().length, KNOWLEDGE_TOPICS.length);

  for (const term of KNOWLEDGE_CATEGORIES) assert.equal(isActiveCategory(term.slug), true);
  for (const term of KNOWLEDGE_TOPICS) assert.equal(isActiveTopic(term.slug), true);
});

test("canonical slugs resolve to themselves", () => {
  assert.equal(getCategory("water_conservation")?.slug, "water_conservation");
  assert.equal(getTopic("rainwater_harvesting")?.slug, "rainwater_harvesting");
});

test("explicit aliases resolve without fuzzy matching", () => {
  assert.equal(getCategory("Water  Conservation")?.slug, "water_conservation");
  assert.equal(getTopic("RAIN WATER HARVESTING")?.slug, "rainwater_harvesting");
  assert.equal(getTopic("ground water recharge")?.slug, "groundwater_recharge");

  assert.equal(getTopic("rainwater-harvesting"), null);
  assert.equal(getTopic("something vaguely water related"), null);
});

test("unknown terms are not silently accepted", () => {
  assert.equal(getCategory("unknown_category"), null);
  assert.equal(getTopic("unknown_topic"), null);
  assert.equal(isActiveCategory("unknown_category"), false);
  assert.equal(isActiveTopic("unknown_topic"), false);
});

test("retired terms are not selectable but remain distinguishable", () => {
  const retired = { slug: "legacy_term", displayName: "Legacy term", status: "RETIRED" };

  assert.equal(isActiveTaxonomyTerm(retired), false);
  assert.deepEqual(getRetiredTaxonomyTerms([retired]), [retired]);
  assert.deepEqual(getRetiredTaxonomyTerms(KNOWLEDGE_TOPICS), []);
});

test("aliases point only to canonical taxonomy identities", () => {
  const allSlugs = new Set([
    ...KNOWLEDGE_CATEGORIES.map((term) => term.slug),
    ...KNOWLEDGE_TOPICS.map((term) => term.slug),
  ]);

  for (const [alias, target] of Object.entries(TAXONOMY_ALIASES)) {
    assert.notEqual(alias, target);
    assert.equal(allSlugs.has(target), true, alias + " -> " + target);
  }
});
