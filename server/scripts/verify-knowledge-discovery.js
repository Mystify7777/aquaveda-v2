import { performance } from "node:perf_hooks";

import { connectDB, disconnectDB } from "../src/config/db.js";
import { Knowledge } from "../src/models/Knowledge.js";
import {
  buildApprovedKnowledgeFilter,
  buildApprovedKnowledgeSort,
} from "../src/services/knowledge.service.js";

const PAGE_SIZE = 20;
const QUERY_FIXTURE = Object.freeze({
  q: "rainwater",
  category: "water_conservation",
  topic: ["rainwater_harvesting", "water_reuse"],
  region: ["bihar", "jharkhand"],
});

function visitPlan(node, visitor) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) visitPlan(child, visitor);
    } else if (value && typeof value === "object") {
      visitPlan(value, visitor);
    }
  }
}

function summarizePlan(plan) {
  const stages = [];
  const indexes = new Set();
  const blockingSortStages = new Set();

  visitPlan(plan, (node) => {
    if (node.stage) stages.push(node.stage);
    if (node.indexName) indexes.add(node.indexName);
    if (node.stage === "SORT" || node.stage === "SORT_MERGE") {
      blockingSortStages.add(node.stage);
    }
  });

  return {
    tree: plan,
    stages: [...new Set(stages)],
    indexes: [...indexes],
    blockingSortStages: [...blockingSortStages],
    hasCollectionScan: stages.includes("COLLSCAN"),
  };
}

async function measure(name, queryOptions) {
  const filter = buildApprovedKnowledgeFilter(queryOptions);
  const sort = buildApprovedKnowledgeSort(queryOptions);
  const startedAt = performance.now();
  const explanation = await Knowledge.find(filter)
    .sort(sort)
    .skip(0)
    .limit(PAGE_SIZE)
    .explain("executionStats");

  const elapsedMs = performance.now() - startedAt;
  const stats = explanation.executionStats;

  return {
    name,
    query: { filter, sort, skip: 0, limit: PAGE_SIZE },
    elapsedMs: Number(elapsedMs.toFixed(3)),
    nReturned: stats.nReturned,
    totalKeysExamined: stats.totalKeysExamined,
    totalDocsExamined: stats.totalDocsExamined,
    winningPlan: summarizePlan(explanation.queryPlanner?.winningPlan),
  };
}

try {
  await connectDB();

  const [totalKnowledge, approvedKnowledge] = await Promise.all([
    Knowledge.countDocuments({}),
    Knowledge.countDocuments({ status: "approved" }),
  ]);

  const scenarios = [
    {
      name: "selective-facets-category-topic-region",
      options: {
        category: QUERY_FIXTURE.category,
        topic: QUERY_FIXTURE.topic,
        region: QUERY_FIXTURE.region,
      },
    },
    { name: "broad-text-search", options: { q: QUERY_FIXTURE.q } },
    { name: "combined-discovery-search-and-all-facets", options: QUERY_FIXTURE },
    { name: "unfiltered-approved-pagination", options: {} },
  ];

  const results = [];
  for (const scenario of scenarios) {
    results.push(await measure(scenario.name, scenario.options));
  }

  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(),
    dataset: { totalKnowledge, approvedKnowledge },
    pageSize: PAGE_SIZE,
    results,
    interpretation: {
      approvedOnly: results.every((result) => result.query.filter.status === "approved"),
      sharedProductionFilterBuilder: true,
      sharedProductionSortBuilder: true,
      regexScan: false,
      revisitWhen: "Revisit built-in text search when representative production-scale explain/latency results show broad or combined search latency, examined-document ratios, index storage, or write cost is material.",
    },
  }, null, 2));
} finally {
  await disconnectDB();
}
