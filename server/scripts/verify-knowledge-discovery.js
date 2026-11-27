import { performance } from "node:perf_hooks";

import { connectDB, disconnectDB } from "../src/config/db.js";
import { Knowledge } from "../src/models/Knowledge.js";

function compactPlan(plan) {
  if (!plan || typeof plan !== "object") return plan;
  const node = { stage: plan.stage };
  for (const key of ["indexName", "keyPattern", "direction"]) {
    if (plan[key] !== undefined) node[key] = plan[key];
  }
  for (const childKey of ["inputStage", "inputStages", "shards"]) {
    if (plan[childKey] !== undefined) {
      node[childKey] = Array.isArray(plan[childKey])
        ? plan[childKey].map(compactPlan)
        : compactPlan(plan[childKey]);
    }
  }
  return node;
}

async function measure(name, filter, sort) {
  const started = performance.now();
  const explanation = await Knowledge.find(filter).sort(sort).limit(20).explain("executionStats");
  const elapsedMs = performance.now() - started;
  const stats = explanation.executionStats;

  return {
    name,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    nReturned: stats.nReturned,
    totalKeysExamined: stats.totalKeysExamined,
    totalDocsExamined: stats.totalDocsExamined,
    winningPlan: compactPlan(explanation.queryPlanner?.winningPlan),
  };
}

try {
  await connectDB();

  const datasetSize = await Knowledge.countDocuments({ status: "approved" });

  const results = await Promise.all([
    measure(
      "selective-category-region",
      {
        status: "approved",
        category: "water_conservation",
        regionKey: { $in: ["bihar", "jharkhand"] },
      },
      { updatedAt: -1, _id: 1 },
    ),
    measure(
      "broad-text-search",
      {
        status: "approved",
        $text: {
          $search: "rainwater",
          $caseSensitive: false,
          $diacriticSensitive: false,
        },
      },
      {
        score: { $meta: "textScore" },
        updatedAt: -1,
        _id: 1,
      },
    ),
  ]);

  console.log(JSON.stringify({
    datasetSize,
    measuredAt: new Date().toISOString(),
    results,
    interpretation: {
      approvedOnly: true,
      regexScan: false,
      searchStrategy: "MongoDB built-in title/body text index",
      revisitWhen: "Measured broad-search latency or text-index storage/write cost becomes material for production traffic.",
    },
  }, null, 2));
} finally {
  await disconnectDB();
}
