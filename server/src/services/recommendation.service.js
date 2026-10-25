import { Issue } from "../models/Issue.js";
import {
  ISSUE_CATEGORY_VALUES,
  ISSUE_SEVERITY_VALUES,
} from "../domain/issue-classification.js";
import { DomainError, DomainErrorCode, notFound } from "./errors.js";

/**
 * Recommendation service.
 *
 * Recommendations are derived at request time from an Issue's persisted
 * classification. They are guidance only: they do not change Issue state,
 * create Knowledge, or grant authority over either domain.
 */

const RULES = Object.freeze([
  {
    id: "leakage-wastage",
    category: "leakage_wastage",
    suggestion:
      "Inspect the reported area for the source of the leak, and arrange a repair or shutoff as soon as it is safe.",
    reason: (issue) =>
      `The Issue is classified as "${issue.category}", which indicates visible leaking, overflowing, or wasted water.`,
  },
  {
    id: "supply-shortage",
    category: "supply_shortage",
    suggestion:
      "Check nearby taps and the local supply schedule, conserve available water, and report the shortage to the responsible water authority if it continues.",
    reason: (issue) =>
      `The Issue is classified as "${issue.category}", which indicates that water is not arriving or is arriving far less than usual.`,
  },
  {
    id: "water-quality",
    category: "water_quality",
    suggestion:
      "Do not drink or use the reported water for cooking until it has been assessed, and notify the responsible water authority or a qualified testing service.",
    reason: (issue) =>
      `The Issue is classified as "${issue.category}", which indicates an unusual colour, smell, taste, or visible pollution.`,
  },
  {
    id: "flooding-drainage",
    category: "flooding_drainage",
    suggestion:
      "Avoid contact with standing water where contamination or electrical hazards are possible, and report blocked drainage or flooding for safe inspection.",
    reason: (issue) =>
      `The Issue is classified as "${issue.category}", which indicates standing water, waterlogging, or blocked drains.`,
  },
  {
    id: "damaged-infrastructure",
    category: "damaged_infrastructure",
    suggestion:
      "Keep people away from unsafe equipment and request inspection or repair from the responsible water-service team.",
    reason: (issue) =>
      `The Issue is classified as "${issue.category}", which indicates that a water facility is broken or not working.`,
  },
  {
    id: "high-severity-escalation",
    severities: ["high", "critical"],
    suggestion:
      "Prioritize reporting this Issue to the responsible local authority and follow local safety guidance while it is being assessed.",
    reason: (issue) =>
      `The Issue has "${issue.severity}" severity, indicating serious disruption or immediate risk.`,
  },
]);

for (const rule of RULES) {
  if (
    rule.category !== undefined &&
    !ISSUE_CATEGORY_VALUES.includes(rule.category)
  ) {
    throw new Error(`Recommendation rule uses an unknown category: ${rule.category}`);
  }
  if (
    rule.severities !== undefined &&
    rule.severities.some((severity) => !ISSUE_SEVERITY_VALUES.includes(severity))
  ) {
    throw new Error(`Recommendation rule uses an unknown severity: ${rule.id}`);
  }
}

function wrapMongooseValidationError(err) {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, err.message, {
      cause: err.name,
    });
  }
  return err;
}

function getContextStatus(issue) {
  const hasCategory = Boolean(issue.category);
  const hasSeverity = Boolean(issue.severity);
  if (!hasCategory && !hasSeverity) return "insufficient_context";
  return hasCategory || hasSeverity ? "classified" : "insufficient_context";
}

function matchesRule(rule, issue) {
  return (
    (rule.category === undefined || rule.category === issue.category) &&
    (rule.severities === undefined || rule.severities.includes(issue.severity))
  );
}

/**
 * getRecommendationsForIssue(issueId)
 *
 * Returns a deterministic, non-persisted snapshot:
 * - `contextStatus: "insufficient_context"` when both classifications are
 *   unclassified;
 * - `contextStatus: "classified"` with zero recommendations when no rule
 *   matches the valid classification; or
 * - `contextStatus: "classified"` with the matching recommendations.
 */
export async function getRecommendationsForIssue(issueId) {
  let issue;
  try {
    issue = await Issue.findById(issueId).select("category severity");
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }

  if (!issue) {
    throw notFound(`Issue ${issueId} not found`);
  }

  const contextStatus = getContextStatus(issue);
  if (contextStatus === "insufficient_context") {
    return {
      issueId: String(issue._id),
      contextStatus,
      recommendations: [],
    };
  }

  const recommendations = RULES.filter((rule) => matchesRule(rule, issue)).map(
    (rule) => ({
      id: rule.id,
      suggestion: rule.suggestion,
      reason: rule.reason(issue),
    }),
  );

  return {
    issueId: String(issue._id),
    contextStatus,
    recommendations,
  };
}
