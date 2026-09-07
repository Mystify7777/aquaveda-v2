import { Project } from "../models/Project.js";
import { Issue } from "../models/Issue.js";
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
