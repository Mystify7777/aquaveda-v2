import { Issue } from "../models/Issue.js";
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
 * listIssues({ page, limit })
 *
 * Public read endpoint — no actorContext required, consistent with
 * Product Invariant 5 ("Anonymous users may explore — browsing the map,
 * reading approved knowledge, and viewing issues never requires an
 * account").
 *
 * Returns a page of Issues sorted by creation date (newest first) with
 * structured pagination metadata. The `{ status: 1 }` index on Issue
 * (persistence-design.md §6) naturally supports future status-filtered
 * queries if added later; this initial implementation returns all issues
 * regardless of status.
 *
 * @param {object} options
 * @param {number} options.page - 1-indexed page number (already validated)
 * @param {number} options.limit - items per page (already validated, max-capped)
 * @returns {Promise<{ data: object[], pagination: object }>}
 */
export async function listIssues({ page, limit }) {
  const skip = (page - 1) * limit;

  const [totalCount, data] = await Promise.all([
    Issue.countDocuments(),
    Issue.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.ceil(totalCount / limit);

  return {
    data,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}
