import { Project } from "../models/Project.js";
import { Issue } from "../models/Issue.js";
// Model-registration side effect only — see issue.service.js's
// identical import for the full explanation.
import "../models/User.js";
import {
  notFound,
  invalidState,
  DomainError,
  DomainErrorCode,
} from "./errors.js";
import { requireActor } from "./authorization.js";

/**
 * Project domain service.
 *
 * Implements createProject only, per the Phase D scope. Project
 * participation and Issue lifecycle authority are deliberately kept
 * separate concepts — creating a Project confers no authority over its
 * originating Issue's status transitions, and this file does not read or
 * write anything related to D-3a.
 *
 * No transaction and no conditional/atomic update are used here. This is
 * a confirmed conclusion, not an oversight: every Issue status that can
 * exist after Project creation remains within the allowed creation set
 * under ADR-0003's transition graph (nothing transitions an Issue back to
 * "open" once it has left that state), so a read-then-insert race cannot
 * make a previously-valid creation retroactively invalid.
 */

const ELIGIBLE_ISSUE_STATUSES = [
  "acknowledged",
  "in_progress",
  "resolved",
  "verified",
];

function wrapMongooseValidationError(err) {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, err.message, {
      cause: err.name,
    });
  }
  return err;
}

// Public-read attribution: name/role only. See issue.service.js's
// identical constant for the full rationale.
const PUBLIC_ACTOR_FIELDS = "_id name role";

/**
 * createProject(actorContext, payload)
 *
 * payload: { title, description, originIssue }
 */
export async function createProject(actorContext, payload) {
  requireActor(actorContext);

  let issue;
  try {
    issue = await Issue.findById(payload.originIssue);
  } catch (err) {
    // Malformed originIssue -> raw Mongoose CastError, translated to the
    // same DomainError contract as every other failure mode.
    throw wrapMongooseValidationError(err);
  }
  if (!issue) {
    throw notFound(`Issue ${payload.originIssue} not found`);
  }

  if (!ELIGIBLE_ISSUE_STATUSES.includes(issue.status)) {
    throw invalidState(
      `a Project cannot be created from an Issue with status "${issue.status}"`,
      { issueStatus: issue.status, eligible: ELIGIBLE_ISSUE_STATUSES },
    );
  }

  try {
    const project = await Project.create({
      title: payload.title,
      description: payload.description,
      originIssue: payload.originIssue,
      creator: actorContext.id,
      contributors: [],
    });
    return project;
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }
}

/**
 * listProjects({originIssue?, page, limit}) — public, Issue #48.
 *
 * No status filter exists — Project has no status/lifecycle field at
 * all (per Project.js's own header comment), so there is nothing to
 * filter by beyond origin. `originIssue` filtering is a real, indexed
 * access pattern (an Issue detail page listing its related Projects),
 * not an invented one. No requireActor() call — genuinely
 * anonymous-accessible.
 */
export async function listProjects({ originIssue, page = 1, limit = 20 } = {}) {
  const filter = {};
  if (originIssue !== undefined) {
    filter.originIssue = originIssue;
  }

  let items;
  let total;
  try {
    const skip = (page - 1) * limit;
    [items, total] = await Promise.all([
      Project.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("creator", PUBLIC_ACTOR_FIELDS)
        .populate("contributors", PUBLIC_ACTOR_FIELDS),
      Project.countDocuments(filter),
    ]);
  } catch (err) {
    // A malformed originIssue filter value throws at query-execution
    // time here (not at a preceding .findById), unlike every write
    // operation in this file — there's no separate "load, then use the
    // id" step for a filter value, so the wrap has to sit around the
    // query itself.
    throw wrapMongooseValidationError(err);
  }

  return {
    items,
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

/**
 * getProjectById(projectId) — public, Issue #48. No requireActor()
 * call — same public-read boundary as listProjects.
 */
export async function getProjectById(projectId) {
  let project;
  try {
    project = await Project.findById(projectId)
      .populate("creator", PUBLIC_ACTOR_FIELDS)
      .populate("contributors", PUBLIC_ACTOR_FIELDS);
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }
  if (!project) {
    throw notFound(`Project ${projectId} not found`);
  }
  return project;
}
