import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKnowledgeMigrationPatch,
  classifyKnowledgeDocument,
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

test("migration falls back to the canonical Other category instead of leaving a record unclassified", () => {
  const result = classifyKnowledgeDocument({
    title: "AquaVeda field notes",
    body: "General water knowledge with no narrower migration signal.",
  });

  assert.equal(result.category, "other");
  assert.deepEqual(result.topics, []);
});

test("migration patch fills only missing taxonomy and Region-key fields", () => {
  const result = buildKnowledgeMigrationPatch({
    _id: "article-1",
    title: "Groundwater recharge",
    body: "Aquifer recharge through a recharge well.",
    region: "  Bihar\u00A0 ",
    category: null,
    topics: null,
    regionKey: null,
    status: "approved",
    author: "author-1",
    reviewHistory: [{ decision: "approved" }],
  });

  assert.deepEqual(result.set, {
    category: "groundwater",
    topics: ["groundwater_recharge"],
    regionKey: "bihar",
  });
  assert.deepEqual(result.issues, []);
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
});

test("migration reports invalid existing taxonomy instead of silently rewriting it", () => {
  const result = buildKnowledgeMigrationPatch({
    title: "Water article",
    body: "General water knowledge.",
    region: "Bihar",
    regionKey: "bihar",
    category: "retired_or_unknown_category",
    topics: ["retired_or_unknown_topic"],
  });

  assert.deepEqual(result.set, {});
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
