import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKnowledgeMigrationPatch,
  classifyKnowledgeDocument,
  MIGRATION_CATEGORY_RULES,
  MIGRATION_TOPIC_RULES,
  PERSISTED_CATEGORY_REWRITES,
  PERSISTED_TOPIC_REWRITES,
  validatePersistedRewriteMap,
} from "../src/domain/knowledge-migration.js";

test("migration classification is deterministic and produces valid taxonomy identities", () => {
  const input = {
    title: "Rainwater harvesting for efficient irrigation",
    body: "Community farmers use drip irrigation to conserve water.",
  };

  const first = classifyKnowledgeDocument(input);
  const second = classifyKnowledgeDocument(input);

  assert.deepEqual(first, second);
  assert.equal(first.category, "agriculture_irrigation");
  assert.deepEqual(first.topics, [
    "efficient_irrigation",
    "rainwater_harvesting",
  ]);
});

test("classification covers every active Category with representative vectors", () => {
  const cases = [
    ["water_conservation", "Water conservation and water saving practices"],
    ["water_supply", "Municipal water supply and piped distribution"],
    ["water_quality", "Water quality monitoring and contamination testing"],
    ["groundwater", "Groundwater levels and aquifer recharge"],
    ["wastewater_sanitation", "Wastewater treatment and sanitation"],
    ["agriculture_irrigation", "Agriculture crops and irrigation"],
    ["flood_drainage", "Flooding and drainage during storms"],
    ["water_governance", "Water policy, regulation and water rights"],
    ["community_practice", "Village community water awareness practices"],
    ["other", "AquaVeda field notes with general water knowledge"],
  ];

  for (const [expected, text] of cases) {
    assert.equal(classifyKnowledgeDocument({ title: text }).category, expected, expected);
  }
});

test("classification covers every active Topic with representative vectors", () => {
  const cases = [
    ["water_reuse", "Water reuse and recycled water"],
    ["efficient_irrigation", "Efficient irrigation with drip irrigation"],
    ["rainwater_harvesting", "Rainwater harvesting and collection"],
    ["sustainable_water_management", "Sustainable water management"],
    ["groundwater_recharge", "Groundwater recharge through an aquifer recharge well"],
    ["water_quality_monitoring", "Water quality monitoring and water testing"],
    ["water_treatment", "Water treatment using filtration and chlorination"],
    ["wastewater_reuse", "Wastewater reuse of treated wastewater"],
    ["sanitation", "Sanitation with septic and toilet facilities"],
    ["stormwater_management", "Stormwater management and urban drainage"],
    ["water_distribution_networks", "Water distribution network and piped distribution"],
    ["water_rights", "Water rights and water entitlement"],
    ["community_water_management", "Community water management in a village"],
    ["drought_management", "Drought management and drought resilience"],
  ];

  for (const [expected, text] of cases) {
    assert.ok(
      classifyKnowledgeDocument({ title: text }).topics.includes(expected),
      expected,
    );
  }
});

test("overlap uses deterministic Category precedence rather than declaration order", () => {
  const result = classifyKnowledgeDocument({
    title: "Rainwater harvesting for efficient irrigation",
    body: "Farmers use drip irrigation to conserve water.",
  });

  assert.equal(result.category, "agriculture_irrigation");
  assert.deepEqual(result.topics, [
    "efficient_irrigation",
    "rainwater_harvesting",
  ]);
});

test("migration falls back to the canonical Other category instead of leaving a record unclassified", () => {
  const result = classifyKnowledgeDocument({
    title: "AquaVeda field notes",
    body: "General water knowledge with no narrower migration signal.",
  });

  assert.equal(result.category, "other");
  assert.deepEqual(result.topics, []);
});

test("migration patch fills independent missing fields even when another taxonomy field is invalid", () => {
  const result = buildKnowledgeMigrationPatch({
    _id: "article-1",
    title: "Groundwater recharge",
    body: "Aquifer recharge through a recharge well.",
    region: "  Bihar\u00A0 ",
    category: "retired_or_unknown_category",
    topics: ["groundwater_recharge", "retired_or_unknown_topic"],
    regionKey: null,
  });

  assert.deepEqual(result.set, {
    regionKey: "bihar",
  });
  assert.deepEqual(result.issues, [
    {
      field: "category",
      value: "retired_or_unknown_category",
      reason: "unknown-or-retired",
    },
    {
      field: "topics",
      value: ["retired_or_unknown_topic"],
      reason: "unknown-or-retired",
    },
  ]);
});

test("migration rewrites explicitly mapped persisted identities and remains idempotent", () => {
  assert.deepEqual(PERSISTED_CATEGORY_REWRITES, {});
  assert.deepEqual(PERSISTED_TOPIC_REWRITES, {});

  const rewriteOptions = {
    categoryRewrites: { legacy_quality: "water_quality" },
    topicRewrites: { legacy_treatment: "water_treatment" },
  };

  const result = buildKnowledgeMigrationPatch(
    {
      category: "legacy_quality",
      topics: ["legacy_treatment", "water_quality_monitoring"],
      region: "Bihar",
      regionKey: null,
      title: "Water treatment",
      body: "Filtration",
    },
    rewriteOptions,
  );

  assert.deepEqual(result.set, {
    category: "water_quality",
    topics: ["water_treatment", "water_quality_monitoring"],
    regionKey: "bihar",
  });
  assert.deepEqual(result.rewrites, [
    { field: "category", from: "legacy_quality", to: "water_quality" },
    { field: "topics", from: "legacy_treatment", to: "water_treatment" },
  ]);
  assert.deepEqual(result.issues, []);

  const rerun = buildKnowledgeMigrationPatch(
    {
      category: "water_quality",
      topics: ["water_treatment", "water_quality_monitoring"],
      region: "Bihar",
      regionKey: "bihar",
      title: "Water treatment",
      body: "Filtration",
    },
    rewriteOptions,
  );

  assert.deepEqual(rerun.set, {});
  assert.deepEqual(rerun.rewrites, []);
  assert.deepEqual(rerun.issues, []);
});

test("persisted rewrite validation rejects inactive targets, active sources, and chains", () => {
  assert.throws(
    () => validatePersistedRewriteMap(
      { legacy: "missing" },
      new Set(["water_quality"]),
      "Category",
    ),
    /target is not ACTIVE/,
  );
  assert.throws(
    () => validatePersistedRewriteMap(
      { water_quality: "other" },
      new Set(["water_quality", "other"]),
      "Category",
    ),
    /cannot be a rewrite source/,
  );
  assert.throws(
    () => validatePersistedRewriteMap(
      { legacy: "middle", middle: "water_quality" },
      new Set(["water_quality"]),
      "Category",
    ),
    /chain\/cycle/,
  );
});

test("rewrite registry is explicit source-controlled infrastructure", () => {
  assert.ok(Object.isFrozen(PERSISTED_CATEGORY_REWRITES));
  assert.ok(Object.isFrozen(PERSISTED_TOPIC_REWRITES));
  assert.equal(MIGRATION_CATEGORY_RULES.length, 9);
  assert.equal(MIGRATION_TOPIC_RULES.length, 14);
});

test("migration does not overwrite already-populated canonical metadata", () => {
  const result = buildKnowledgeMigrationPatch({
    title: "Water quality monitoring",
    body: "Monitor water quality.",
    region: "Bihar",
    regionKey: "bihar",
    category: "water_quality",
    topics: ["water_quality_monitoring"],
  });

  assert.deepEqual(result.set, {});
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rewrites, []);
});
