import mongoose from "mongoose";

import { Issue } from "../models/Issue.js";
import { Knowledge } from "../models/Knowledge.js";
import { Project } from "../models/Project.js";
import { requireActor } from "./authorization.js";
import { unauthorized } from "./errors.js";

/**
 * Dashboard read contract (Issue #53). Contract: docs/architecture/dashboard-contract.md.
 *
 * A read-only, derived view: nothing here is persisted and no domain model,
 * collection or index is added (decision register: dashboard data stays fully
 * derived via aggregation). Authorization is the existing `requireActor` only:
 * any authenticated actor may read their own `mine` block, and `platform`
 * contains aggregates of data that is already public. No role, ownership or
 * participation is ever treated as authority (D-3a untouched).
 *
 * The response is built field by field from the aggregation results; no
 * document, `_id` or Mongoose metadata can reach it.
 */

// Status vocabularies come from the schemas (single source of truth); the
// contract test pins the exact lists so a schema change cannot alter the
// Dashboard response silently.
const ISSUE_STATUSES = Issue.schema.path("status").enumValues;
const KNOWLEDGE_STATUSES = Knowledge.schema.path("status").enumValues;

function zeroed(keys) {
  return Object.fromEntries(keys.map((k) => [k, 0]));
}

/** Rows of `{ _id: status, count }` -> `{ total, byStatus }`, zero-filled; unknown statuses are ignored. */
function statusBreakdown(rows, statuses) {
  const byStatus = zeroed(statuses);
  for (const { _id, count } of rows) {
    if (Object.hasOwn(byStatus, _id)) byStatus[_id] = count;
  }
  const total = statuses.reduce((sum, s) => sum + byStatus[s], 0);
  return { total, byStatus };
}

const groupByStatus = (match = {}) => [{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }];

/**
 * @param {{ id: string, role: string } | null | undefined} actorContext
 * @returns {Promise<object>} the Dashboard DTO
 */
export async function getDashboard(actorContext) {
  requireActor(actorContext);
  // Aggregation pipelines do not cast ids like find() does.
  if (!mongoose.isValidObjectId(actorContext.id)) {
    throw unauthorized("an authenticated actor is required");
  }
  const me = new mongoose.Types.ObjectId(String(actorContext.id));

  const [
    platformIssueRows,
    myIssueRows,
    approvedKnowledge,
    myKnowledgeRows,
    totalProjects,
    createdProjects,
    contributingProjects,
  ] = await Promise.all([
    Issue.aggregate(groupByStatus()),
    Issue.aggregate(groupByStatus({ reportedBy: me })),
    Knowledge.countDocuments({ status: "approved" }),
    Knowledge.aggregate(groupByStatus({ author: me })),
    Project.countDocuments({}),
    Project.countDocuments({ creator: me }),
    // Disjoint from `created`: a project is counted once, under the role the actor holds in it.
    Project.countDocuments({ contributors: me, creator: { $ne: me } }),
  ]);

  return {
    platform: {
      issues: statusBreakdown(platformIssueRows, ISSUE_STATUSES),
      knowledge: { approved: approvedKnowledge },
      projects: { total: totalProjects },
    },
    mine: {
      issuesReported: statusBreakdown(myIssueRows, ISSUE_STATUSES),
      knowledge: statusBreakdown(myKnowledgeRows, KNOWLEDGE_STATUSES),
      projects: { created: createdProjects, contributing: contributingProjects },
    },
  };
}
