import { pathToFileURL } from "node:url";

import { connectDB, disconnectDB } from "../src/config/db.js";
import { Knowledge } from "../src/models/Knowledge.js";
import { buildKnowledgeMigrationPatch } from "../src/domain/knowledge-migration.js";

const BATCH_SIZE = 500;

export async function migrateKnowledgeTaxonomy({ apply = false } = {}) {
  const summary = {
    candidates: 0,
    wouldUpdate: 0,
    modified: 0,
    alreadyComplete: 0,
    fallbackCategory: 0,
    blankRegion: 0,
    unaliasedRegionKeys: new Set(),
    invalidExistingTaxonomy: 0,
    applied: apply,
  };

  const invalidRecords = [];
  const operations = [];

  const cursor = Knowledge.collection.find(
    {},
    {
      projection: {
        _id: 1,
        title: 1,
        body: 1,
        region: 1,
        regionKey: 1,
        category: 1,
        topics: 1,
      },
    },
  ).sort({ _id: 1 });

  for await (const document of cursor) {
    summary.candidates += 1;

    const { set, issues, classification } = buildKnowledgeMigrationPatch(document);

    if (classification.category === "other") {
      summary.fallbackCategory += 1;
    }

    if (document.regionKey == null) {
      if (set.regionKey === "") {
        summary.blankRegion += 1;
      } else {
        summary.unaliasedRegionKeys.add(set.regionKey);
      }
    }

    if (issues.length > 0) {
      summary.invalidExistingTaxonomy += 1;
      invalidRecords.push({
        id: String(document._id),
        issues,
      });
      continue;
    }

    if (Object.keys(set).length === 0) {
      summary.alreadyComplete += 1;
      continue;
    }

    summary.wouldUpdate += 1;

    if (apply) {
      operations.push({
        updateOne: {
          filter: { _id: document._id },
          update: { $set: set },
        },
      });

      if (operations.length >= BATCH_SIZE) {
        const result = await Knowledge.collection.bulkWrite(operations, { ordered: true });
        summary.modified += result.modifiedCount;
        operations.length = 0;
      }
    }
  }

  if (apply && operations.length > 0) {
    const result = await Knowledge.collection.bulkWrite(operations, { ordered: true });
    summary.modified += result.modifiedCount;
  }

  return {
    ...summary,
    unaliasedRegionKeys: [...summary.unaliasedRegionKeys].sort(),
    invalidRecords,
  };
}

function printReport(report) {
  console.log(JSON.stringify({
    ...report,
    mode: report.applied ? "apply" : "dry-run",
  }, null, 2));
}

async function main() {
  const apply = process.argv.includes("--apply");

  await connectDB();
  try {
    const report = await migrateKnowledgeTaxonomy({ apply });
    printReport(report);

    if (report.invalidExistingTaxonomy > 0) {
      process.exitCode = 2;
    }
  } finally {
    await disconnectDB();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[migrate-knowledge-taxonomy] failed: ${err?.name ?? "Error"}`);
    process.exitCode = 1;
  });
}
