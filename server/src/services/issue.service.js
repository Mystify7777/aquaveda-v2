import { Issue } from "../models/Issue.js";
// Imported for its model-registration side effect only — not called
// directly by this file. Mongoose's .populate("reportedBy", ...) below
// needs the "User" model registered in this process before the query
// runs; every write operation in this file already ran fine without
// this import (services never queried the User collection before
// Issue #48's read endpoints), so it's added here specifically for the
// new listIssues/getIssueById functions, not incidentally.
import "../models/User.js";
import {
  notFound,
  forbidden,
  invalidState,
  stateRace,
  authorizationPolicyUnresolved,
  DomainError,
  DomainErrorCode,
} from "./errors.js";
import { requireActor, requireRole } from "./authorization.js";

/**
 * Issue domain service.
 *
 * Implements createIssue and changeStatus per ADR-0003 (transition graph),
 * ADR-0005 (embedded, history-only actor identity — no resolvedBy/
 * verifiedBy fields), and ADR-0006 (conditional atomic transitions).
 *
 * This module receives an already-resolved `actorContext = { id, role }`
 * for every operation. It does not decode tokens, read headers, or query
 * session state — how actorContext was produced is entirely outside this
 * file's concern (Authentication milestone, not yet built).
 *
 * Payload shape validation (Zod) is an API-boundary concern that does not
 * exist yet in this milestone (no routes/controllers). These functions
 * assume the caller has already produced a shape-valid payload; Mongoose's
 * own schema validation is the structural backstop, and any Mongoose
 * ValidationError/CastError raised here is translated into a
 * DomainError(VALIDATION_FAILED) so callers never have to know Mongoose
 * exists. This translation point is a service-layer implementation
 * decision, not something any approved document specifies — flagged for
 * visibility in the Phase D report.
 */

const ISSUE_STATUSES = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "verified",
];

// Public-read attribution: name/role only, never email or any other
// User field — reads are anonymous-accessible (Issue #48), and no
// approved policy permits exposing a reporter's email to any visitor.
const PUBLIC_ACTOR_FIELDS = "_id name role";

// The exact legal transition graph, per ADR-0003 and the Phase D contract.
// `resolved` is the only status with two legal targets (successful
// verification, or failed verification looping back).
const LEGAL_TRANSITIONS = Object.freeze({
  open: ["acknowledged"],
  acknowledged: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["verified", "in_progress"],
  verified: [],
});

function wrapMongooseValidationError(err) {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, err.message, {
      cause: err.name,
    });
  }
  return err;
}

/**
 * createIssue(actorContext, payload)
 *
 * payload: { title, description, location, severity?, category?, domain? }
 * — never accepts status, statusHistory, or reportedBy from the caller.
 */
export async function createIssue(actorContext, payload) {
  requireActor(actorContext);

  const now = new Date();

  try {
    const issue = await Issue.create({
      title: payload.title,
      description: payload.description,
      location: payload.location,
      severity: payload.severity,
      category: payload.category,
      domain: payload.domain,
      reportedBy: actorContext.id,
      status: "open",
      statusHistory: [
        {
          fromStatus: null,
          toStatus: "open",
          actor: actorContext.id,
          timestamp: now,
        },
      ],
    });
    return issue;
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }
}

/**
 * Authorization for a specific transition. Returns nothing on success;
 * throws a DomainError on failure. Kept as its own function so the D-3a
 * gate is a single, clearly-named place rather than inline branching
 * spread through changeStatus().
 *
 * @param {"open"|"acknowledged"|"in_progress"|"resolved"|"verified"} fromStatus
 * @param {string} targetStatus
 * @param {{id: string, role: string}} actorContext
 * @param {object} issueDoc - the currently-loaded Issue, needed for the
 *   history-derived verification check
 */
function authorizeTransition(fromStatus, targetStatus, actorContext, issueDoc) {
  if (fromStatus === "open" && targetStatus === "acknowledged") {
    requireRole(actorContext, "EXPERT");
    return;
  }

  if (fromStatus === "acknowledged" && targetStatus === "in_progress") {
    // D-3a: remediation-assertion authority is unresolved. This is not
    // an ordinary authorization failure — no actor, of any role, can be
    // correctly evaluated for this transition yet, because the policy
    // itself does not exist. Do not fall back to "any authenticated
    // user," a REMEDIATOR role, or Project-membership authority.
    throw authorizationPolicyUnresolved(
      "authorization for acknowledged -> in_progress is not yet defined (D-3a)",
      { transition: "acknowledged->in_progress" },
    );
  }

  if (fromStatus === "in_progress" && targetStatus === "resolved") {
    // Same D-3a gate.
    throw authorizationPolicyUnresolved(
      "authorization for in_progress -> resolved is not yet defined (D-3a)",
      { transition: "in_progress->resolved" },
    );
  }

  if (fromStatus === "resolved" && targetStatus === "verified") {
    requireRole(actorContext, "EXPERT");
    // History-derived actor check (Phase D contract point 2): the
    // verifying actor must differ from the actor recorded in the most
    // recent relevant history entry — the in_progress -> resolved entry
    // that produced the current `resolved` status. No top-level
    // resolverId/verifierId field exists anywhere; this is read from the
    // statusHistory array itself, at the moment it's needed.
    const lastEntry = issueDoc.statusHistory[issueDoc.statusHistory.length - 1];
    if (!lastEntry || lastEntry.toStatus !== "resolved") {
      // Defensive: should be unreachable if statusHistory is always
      // correctly appended, but this is exactly the kind of assumption
      // worth checking rather than trusting silently.
      throw invalidState(
        "expected the most recent history entry to record the resolved transition",
        { statusHistory: issueDoc.statusHistory },
      );
    }
    if (String(lastEntry.actor) === String(actorContext.id)) {
      throw forbidden(
        "the actor who resolved an Issue may not also verify it",
        { transition: "resolved->verified" },
      );
    }
    return;
  }

  if (fromStatus === "resolved" && targetStatus === "in_progress") {
    // Failed verification. EXPERT-authorized, per ADR-0003.
    requireRole(actorContext, "EXPERT");
    return;
  }

  // Should be unreachable — transition legality is checked before this
  // function is called. If reached, it means LEGAL_TRANSITIONS and this
  // function have drifted out of sync with each other.
  throw invalidState(
    `no authorization rule defined for ${fromStatus} -> ${targetStatus}`,
  );
}

/**
 * changeStatus(actorContext, issueId, targetStatus)
 *
 * Implements the ADR-0006 conditional-atomic-update sequence:
 *   1. load current state
 *   2. validate transition legality
 *   3. validate authorization
 *   4. conditional atomic update, gated on the expected current status
 *   5. zero-match -> distinguish not-found vs. state-race
 */
export async function changeStatus(actorContext, issueId, targetStatus) {
  requireActor(actorContext);

  if (!ISSUE_STATUSES.includes(targetStatus)) {
    throw invalidState(`"${targetStatus}" is not a recognized Issue status`);
  }

  let issue;
  try {
    issue = await Issue.findById(issueId);
  } catch (err) {
    // A malformed issueId (not a valid ObjectId shape) throws a raw
    // Mongoose CastError here — translated to the same DomainError
    // contract callers already expect from every other failure mode,
    // rather than letting Mongoose's own error type leak past this
    // module. Once this read succeeds (even with a null result), the
    // id's shape is confirmed valid, so no other call site in this
    // function needs the same wrapping.
    throw wrapMongooseValidationError(err);
  }
  if (!issue) {
    throw notFound(`Issue ${issueId} not found`);
  }

  const expectedStatus = issue.status;
  const legalTargets = LEGAL_TRANSITIONS[expectedStatus] ?? [];
  if (!legalTargets.includes(targetStatus)) {
    throw invalidState(
      `illegal transition: ${expectedStatus} -> ${targetStatus}`,
      { from: expectedStatus, to: targetStatus },
    );
  }

  // Authorization check happens AFTER confirming the transition is
  // legal at all — an illegal target is reported as such regardless of
  // who's asking, rather than leaking authorization details about a
  // transition that could never happen anyway.
  authorizeTransition(expectedStatus, targetStatus, actorContext, issue);

  const now = new Date();
  const updated = await Issue.findOneAndUpdate(
    { _id: issueId, status: expectedStatus },
    {
      $set: { status: targetStatus },
      $push: {
        statusHistory: {
          fromStatus: expectedStatus,
          toStatus: targetStatus,
          actor: actorContext.id,
          timestamp: now,
        },
      },
    },
    { new: true, runValidators: true },
  );

  if (updated) {
    return updated;
  }

  // Zero-match: the conditional filter (_id + expected status) matched
  // nothing. Distinguish "deleted between read and write" from "state
  // changed between read and write" — conflating them would mislabel a
  // genuine concurrency race as a not-found error. ADR-0006 requires
  // this distinction explicitly.
  const stillExists = await Issue.exists({ _id: issueId });
  if (!stillExists) {
    throw notFound(
      `Issue ${issueId} was deleted before the transition completed`,
    );
  }
  throw stateRace(
    `Issue ${issueId} status changed before this transition could be applied`,
    { expectedStatus, targetStatus },
  );
}

/**
 * listIssues({status?, page, limit}) — public, Issue #48.
 *
 * No requireActor() call: this is a genuinely anonymous-accessible read
 * (Product Invariant: anonymous users must still be able to browse
 * Explore). No authorization rule is invented here beyond "anyone may
 * read" — the established public-read boundary Issue #48's own
 * constraints require, not a step toward role-based read filtering
 * that no approved document has ever specified.
 */
export async function listIssues({ status, page = 1, limit = 20 } = {}) {
  const filter = {};
  if (status !== undefined) {
    if (!ISSUE_STATUSES.includes(status)) {
      throw invalidState(`"${status}" is not a recognized Issue status`, {
        status,
      });
    }
    filter.status = status;
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Issue.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("reportedBy", PUBLIC_ACTOR_FIELDS),
    Issue.countDocuments(filter),
  ]);

  return {
    items,
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

/**
 * getIssueById(issueId) — public, Issue #48. No requireActor() call —
 * same public-read boundary as listIssues.
 */
export async function getIssueById(issueId) {
  let issue;
  try {
    issue = await Issue.findById(issueId).populate(
      "reportedBy",
      PUBLIC_ACTOR_FIELDS,
    );
  } catch (err) {
    // Malformed issueId -> raw Mongoose CastError, translated to the
    // same DomainError contract as every write-path operation in this
    // file.
    throw wrapMongooseValidationError(err);
  }
  if (!issue) {
    throw notFound(`Issue ${issueId} not found`);
  }
  return issue;
}
