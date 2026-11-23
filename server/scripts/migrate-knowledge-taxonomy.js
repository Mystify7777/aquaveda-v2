import { appendFile, rename, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { connectDB, disconnectDB } from "../src/config/db.js";
import { Knowledge } from "../src/models/Knowledge.js";
import { buildKnowledgeMigrationPatch } from "../src/domain/knowledge-migration.js";

const BATCH_SIZE = 500;
const DEFAULT_REPORT_FILE = "knowledge-taxonomy-migration-report.jsonl";

function buildExpectedFilter(document, set, rewrites) {
  const conditions = [];

  for (const field of Object.keys(set)) {
    conditions.push(
      document[field] == null
        ? { [field]: { $in: [null] } }
        : { [field]: document[field] },
    );
  }

  for (const rewrite of rewrites) {
    if (rewrite.field === "category") {
      conditions.push({ category: rewrite.from });
    }
    if (rewrite.field === "topics") {
      conditions.push({ topics: document.topics });
    }
  }

  return conditions.length > 0
    ? { _id: document._id, $and: conditions }
    : { _id: document._id };
}

function buildReviewRecord(document, patch) {
  return {
    id: String(document._id),
    action: Object.keys(patch.set).length > 0 ? "update" : patch.issues.length > 0 ? "review" : "complete",
    existing: {
      category: document.category ?? null,
      topics: document.topics ?? null,
      region: document.region ?? null,
      regionKey: document.regionKey ?? null,
    },
    proposed: patch.set,
    rewrites: patch.rewrites,
    classification: patch.classification,
    issues: patch.issues,
  };
}

export async function migrateKnowledgeTaxonomy({
  apply = false,
  reportFile = null,
  collectReviewRecords = false,
} = {}) {
  const summary = {
    candidates: 0,
    wouldUpdate: 0,
    modified: 0,
    alreadyComplete: 0,
    fallbackCategory: 0,
    blankRegion: 0,
    unaliasedRegionKeys: new Set(),
    invalidExistingTaxonomy: 0,
    rewrittenReferences: 0,
    applied: apply,
  };

  const reviewRecords = [];
  const reportLines = [];
  const operations = [];

  const temporaryReportFile = reportFile ? `${reportFile}.tmp-${process.pid}` : null;

  if (temporaryReportFile) {
    await rm(temporaryReportFile, { force: true });
  }

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

    const patch = buildKnowledgeMigrationPatch(document);

    if (document.category == null && patch.classification.category === "other") {
      summary.fallbackCategory += 1;
    }

    if (document.regionKey == null) {
      if (patch.set.regionKey === "") {
        summary.blankRegion += 1;
      } else {
        summary.unaliasedRegionKeys.add(patch.set.regionKey);
      }
    }

    if (patch.rewrites.length > 0) {
      summary.rewrittenReferences += patch.rewrites.length;
    }

    if (patch.issues.length > 0) {
      summary.invalidExistingTaxonomy += 1;
    }

    if (Object.keys(patch.set).length === 0) {
      summary.alreadyComplete += 1;
    } else {
      summary.wouldUpdate += 1;
    }

    const reviewRecord = buildReviewRecord(document, patch);

    if (collectReviewRecords) {
      reviewRecords.push(reviewRecord);
    }

    if (reportFile) {
      reportLines.push(JSON.stringify(reviewRecord));

      if (reportLines.length >= BATCH_SIZE) {
        await appendFile(temporaryReportFile, reportLines.join("\n") + "\n");
        reportLines.length = 0;
      }
    }

    if (apply && Object.keys(patch.set).length > 0) {
      operations.push({
        updateOne: {
          filter: buildExpectedFilter(document, patch.set, patch.rewrites),
          update: { $set: patch.set },
        },
      });

      if (operations.length >= BATCH_SIZE) {
        const result = await Knowledge.collection.bulkWrite(operations, { ordered: true });
        summary.modified += result.modifiedCount;
        operations.length = 0;
      }
    }
  }

  if (reportFile && reportLines.length > 0) {
    await appendFile(temporaryReportFile, reportLines.join("\n") + "\n");
  }

  if (temporaryReportFile) {
    await rename(temporaryReportFile, reportFile);
  }

  if (apply && operations.length > 0) {
    const result = await Knowledge.collection.bulkWrite(operations, { ordered: true });
    summary.modified += result.modifiedCount;
  }

  return {
    ...summary,
    unaliasedRegionKeys: [...summary.unaliasedRegionKeys].sort(),
    reviewRecords,
    reportFile,
  };
}

function printReport(report) {
  console.log(JSON.stringify({
    ...report,
    reviewRecords: undefined,
    mode: report.applied ? "apply" : "dry-run",
  }, null, 2));

  if (report.reportFile) {
    console.log(`[migrate-knowledge-taxonomy] review report: ${report.reportFile}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const reportIndex = process.argv.indexOf("--report");

  let reportFile = DEFAULT_REPORT_FILE;
  if (reportIndex >= 0 && process.argv[reportIndex + 1]) {
    reportFile = process.argv[reportIndex + 1];
  }

  await connectDB();
  try {
    const report = await migrateKnowledgeTaxonomy({ apply, reportFile });
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
