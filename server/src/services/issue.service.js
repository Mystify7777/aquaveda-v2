import { Issue } from "../models/Issue.js";
// Imported for its model-registration side effect only — not called
// directly by this file. Mongoose's .populate("reportedBy", ...) below
// needs the "User" model registered in this process before the query
// runs; every write operation in this file already ran fine without
// this import (services never queried the User collection before
// Issue #48's read endpoints), so it's added here specifically for the
// new listIssues/getIssueById functions, not incidentally.
import { User } from "../models/User.js";
import {
  notFound,
  forbidden,
  invalidState,
  stateRace,
  DomainError,
  DomainErrorCode,
} from "./errors.js";
import { requireActor, requireRole } from "./authorization.js";
import {
  ISSUE_CATEGORY_VALUES,
  ISSUE_SEVERITY_VALUES,
} from "../domain/issue-classification.js";
import { bboxProblem, searchTextProblem, searchTerms } from "../domain/issue-search.js";
import { locationLabelProblem, normalizeLocationLabel } from "../domain/location-label.js";
import { parseNote } from "../domain/lifecycle-note.js";
import {
  projectPublicActivityLog,
  projectPublicAssignee,
  projectWorkflowView,
} from "../domain/issue-activity.js";
import {
  toMutationDTO,
  toPublicIssueDetailDTO,
  toPublicIssueSummaryDTO,
  toWorkflowDTO,
} from "./issue.dto.js";

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
 * payload: { title, description, location, locationLabel?, severity?, category?, domain? }
 * — never accepts status, statusHistory, or reportedBy from the caller.
 */
export async function createIssue(actorContext, payload) {
  requireActor(actorContext);

  // Untrusted display text (#134). Same rules as createIssueSchema — one
  // contract (domain/location-label.js), enforced here too because this
  // service is also called directly, bypassing Zod.
  if (payload.locationLabel !== undefined && typeof payload.locationLabel !== "string") {
    throw validationFailed("locationLabel must be a string", { field: "locationLabel" });
  }
  const locationLabel = normalizeLocationLabel(payload.locationLabel);
  const labelProblem = locationLabelProblem(locationLabel);
  if (labelProblem) throw validationFailed(labelProblem, { field: "locationLabel" });

  const now = new Date();

  try {
    const issue = await Issue.create({
      title: payload.title,
      description: payload.description,
      location: payload.location,
      locationLabel,
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
 * Authorization for a specific transition. Returns `{ grantId }` for the
 * grant-dependent transitions (so the caller can put the EXACT grant observed
 * here into the atomic filter, ADR-0007 §4) and `{}` otherwise; throws a
 * DomainError on failure.
 *
 * Remediation authority (ADR-0007, which resolved D-3a) comes ONLY from an
 * accepted grant held by the actor: no role, ownership, reporter status,
 * Project membership, or ADMIN grants it.
 *
 * Error choice for the grant-dependent transitions: status legality was
 * already checked (status is public). A non-grantee gets FORBIDDEN
 * uniformly — whether a pending grant exists is private (ADR-0007 §7) and
 * must not be distinguishable. The grantee of a still-pending grant gets
 * INVALID_STATE (they already know about it).
 *
 * @param {"open"|"acknowledged"|"in_progress"|"resolved"|"verified"} fromStatus
 * @param {string} targetStatus
 * @param {{id: string, role: string}} actorContext
 * @param {object} issueDoc - the currently-loaded Issue, needed for the
 *   history-derived verification check and the grant check
 * @returns {{ grantId?: import("mongoose").Types.ObjectId }}
 */
function authorizeTransition(fromStatus, targetStatus, actorContext, issueDoc) {
  if (fromStatus === "open" && targetStatus === "acknowledged") {
    requireRole(actorContext, "EXPERT");
    return {};
  }

  if (
    (fromStatus === "acknowledged" && targetStatus === "in_progress") ||
    (fromStatus === "in_progress" && targetStatus === "resolved")
  ) {
    const transition = `${fromStatus}->${targetStatus}`;
    const grant = issueDoc.remediation;
    if (!grant || String(grant.actor) !== String(actorContext.id)) {
      throw forbidden(
        "only the accepted remediation grantee may perform this transition",
        { transition },
      );
    }
    if (!grant.acceptedAt) {
      throw invalidState("the remediation grant has not been accepted yet", {
        transition,
        reason: "GRANT_NOT_ACCEPTED",
      });
    }
    return { grantId: grant.grantId };
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
    return {};
  }

  if (fromStatus === "resolved" && targetStatus === "in_progress") {
    // Failed verification. EXPERT-authorized, per ADR-0003.
    requireRole(actorContext, "EXPERT");
    return {};
  }

  // Should be unreachable — transition legality is checked before this
  // function is called. If reached, it means LEGAL_TRANSITIONS and this
  // function have drifted out of sync with each other.
  throw invalidState(
    `no authorization rule defined for ${fromStatus} -> ${targetStatus}`,
  );
}

/** Transitions whose explanation is mandatory (ADR-0007 §6). */
const NOTE_REQUIRED_TRANSITIONS = new Set([
  "in_progress->resolved", // the resolution statement
  "resolved->verified", // the verification rationale
  "resolved->in_progress", // the failed-verification reason
]);

/**
 * changeStatus(actorContext, issueId, targetStatus, { note })
 *
 * Implements the ADR-0006 conditional-atomic-update sequence:
 *   1. load current state
 *   2. validate transition legality
 *   3. validate authorization (accepted grantee / EXPERT rules)
 *   4. validate the note (required for resolve, verify, reject)
 *   5. conditional atomic update, gated on everything observed in step 1
 *   6. zero-match -> distinguish not-found vs. state-race
 *
 * CONCURRENCY CORRECTNESS REQUIREMENT (do not "simplify" away): the write's
 * filter pins the status AND the observed `statusHistory` length. The history
 * is append-only, so an unchanged length means "no transition has been
 * recorded since the pre-read". Pinning the status alone is not enough: a
 * status can return to its original value (resolved -> in_progress ->
 * resolved), and a pre-read-derived authorization decision — "the resolver
 * is A, so verifier B is independent" — is then silently stale (B may have
 * become the resolver in between). This ABA race was reproduced against the
 * previous filter (#140, finding M2) and let a resolver verify their own
 * resolution. Grant-dependent transitions additionally pin the exact observed
 * grant (`remediation.grantId` + actor + accepted), so a withdrawn/replaced
 * grant can never authorize a stale write. A zero-match write NEVER reports
 * FORBIDDEN: a stale snapshot cannot prove the actor lacked authority.
 *
 * @param {{id: string, role: string}} actorContext
 * @param {string} issueId
 * @param {string} targetStatus
 * @param {{ note?: string }} [options] untrusted plain text; required for
 *   resolve/verify/reject, optional otherwise
 */
export async function changeStatus(actorContext, issueId, targetStatus, { note, expectedFrom } = {}) {
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
  // Explicit-edge guard (#142): a named route (start, fail-verification, ...)
  // pins its SOURCE status, not only its target, because two edges share
  // `in_progress` as a target. Evaluated with the legality check, before
  // authorization, and reported identically. The atomic filter below is
  // unchanged (status + statusHistory length + grant pins, ADR-0006/0007).
  const wrongSource = expectedFrom !== undefined && expectedFrom !== expectedStatus;
  if (wrongSource || !legalTargets.includes(targetStatus)) {
    throw invalidState(
      `illegal transition: ${expectedStatus} -> ${targetStatus}`,
      { from: expectedStatus, to: targetStatus },
    );
  }

  // Authorization check happens AFTER confirming the transition is
  // legal at all — an illegal target is reported as such regardless of
  // who's asking, rather than leaking authorization details about a
  // transition that could never happen anyway.
  const authorization = authorizeTransition(expectedStatus, targetStatus, actorContext, issue);

  // Note validation is after authorization so an unauthorized caller learns
  // nothing from note errors.
  const parsedNote = parseNote(note, {
    required: NOTE_REQUIRED_TRANSITIONS.has(`${expectedStatus}->${targetStatus}`),
  });
  if (!parsedNote.ok) {
    throw validationFailed(parsedNote.problem, { field: "note" });
  }

  const filter = {
    _id: issueId,
    status: expectedStatus,
    // Concurrency correctness requirement — see the function comment.
    statusHistory: { $size: issue.statusHistory.length },
  };
  if (authorization.grantId) {
    filter["remediation.grantId"] = authorization.grantId;
    filter["remediation.actor"] = actorContext.id;
    filter["remediation.acceptedAt"] = { $ne: null };
  }

  const now = new Date();
  const updated = await Issue.findOneAndUpdate(
    filter,
    {
      $set: { status: targetStatus },
      $push: {
        statusHistory: {
          fromStatus: expectedStatus,
          toStatus: targetStatus,
          actor: actorContext.id,
          timestamp: now,
          ...(parsedNote.value !== undefined ? { note: parsedNote.value } : {}),
        },
      },
    },
    { new: true, runValidators: true },
  );

  if (updated) {
    return updated;
  }

  // Zero-match: the conditional filter matched nothing. Distinguish
  // "deleted between read and write" from "state changed between read and
  // write" — conflating them would mislabel a genuine concurrency race as a
  // not-found error. ADR-0006 requires this distinction explicitly.
  const stillExists = await Issue.exists({ _id: issueId });
  if (!stillExists) {
    throw notFound(
      `Issue ${issueId} was deleted before the transition completed`,
    );
  }
  throw stateRace(
    `Issue ${issueId} changed before this transition could be applied`,
    { expectedStatus, targetStatus },
  );
}

/**
 * Extra radius (radians; ~0.1 degree) added to the index-assisted circle
 * so every point of the box lies strictly inside it. The circle is only a
 * candidate filter; the exact bounds below decide membership, so no
 * boundary behavior of the spherical operator is ever relied upon.
 */
const BBOX_CIRCLE_MARGIN_RADIANS = (0.1 * Math.PI) / 180;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance in radians between two [lng, lat] points (haversine). */
function angularDistance([lng1, lat1], [lng2, lat2]) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Regex source matching `term` literally (every metacharacter escaped, so
 * user input is never interpreted as a pattern) only where it is not
 * directly preceded or followed by a letter or digit — i.e. as a whole
 * word. Case-insensitivity comes from the `i` option; Unicode letters and
 * digits count as word characters, so non-Latin scripts work.
 */
function wordMatcher(term) {
  const literal = term.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
  return `(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`;
}

/**
 * Builds the MongoDB filter for a public Issue discovery query (Issue #41,
 * docs/architecture/issue-discovery-contract.md). Exported so tests can
 * run the *same* filter through `explain()`.
 *
 * - `q`: every term must appear as a whole word in the title or the
 *   description. Two cooperating parts, because neither alone is correct:
 *   1. `$text` over the text index selects *candidates* (index-assisted).
 *      Each term is quoted so MongoDB's query syntax (`-term`, phrases) has
 *      no meaning. Multiple quoted terms are ANDed — but quoted-phrase
 *      matching is a *substring* test on whatever the index scan returned,
 *      and the scan is an OR over the terms' tokens, so on its own a term
 *      could match inside a longer word ("main" in "maintenance") whenever
 *      another term supplied the candidate.
 *   2. Per term, an exact whole-word check (`wordMatcher`) over title or
 *      description, applied to those candidates only, makes every term
 *      required as a whole word, with no stemming.
 * - `bbox` ([west, south, east, north]): an index-assisted `$geoWithin`
 *   `$centerSphere` circle that strictly encloses the box (its center is
 *   the box center, its radius reaches the farthest corner plus a margin),
 *   plus exact edge-inclusive planar bounds on the stored
 *   [longitude, latitude] — the Issue's affected location. The circle
 *   makes the query use the 2dsphere index; the bounds make it exact.
 */
export function buildIssueListFilter({ status, category, severity, q, bbox } = {}) {
  const filter = {};
  if (status !== undefined) filter.status = status;
  if (category !== undefined) filter.category = category;
  if (severity !== undefined) filter.severity = severity;

  if (q !== undefined) {
    const terms = searchTerms(q);
    filter.$text = { $search: terms.map((term) => `"${term}"`).join(" ") };
    filter.$and = terms.map((term) => {
      const matcher = { $regex: wordMatcher(term), $options: "i" };
      return { $or: [{ title: matcher }, { description: matcher }] };
    });
  }

  if (bbox !== undefined) {
    const [west, south, east, north] = bbox;
    const center = [(west + east) / 2, (south + north) / 2];
    const radius =
      Math.max(
        ...[
          [west, south],
          [east, south],
          [east, north],
          [west, north],
        ].map((corner) => angularDistance(center, corner)),
      ) + BBOX_CIRCLE_MARGIN_RADIANS;
    filter.location = { $geoWithin: { $centerSphere: [center, radius] } };
    filter["location.coordinates.0"] = { $gte: west, $lte: east };
    filter["location.coordinates.1"] = { $gte: south, $lte: north };
  }
  return filter;
}

const validationFailed = (message, details) =>
  new DomainError(DomainErrorCode.VALIDATION_FAILED, message, details);

/**
 * listIssues({status?, category?, severity?, q?, bbox?, page, limit}) —
 * public, Issues #48 and #41.
 *
 * No requireActor() call: this is a genuinely anonymous-accessible read
 * (Product Invariant: anonymous users must still be able to browse
 * Explore). No authorization rule is invented here beyond "anyone may
 * read" — the established public-read boundary Issue #48's own
 * constraints require, not a step toward role-based read filtering
 * that no approved document has ever specified.
 *
 * Ordering is always newest first with `_id` as the tiebreaker, so offset
 * pagination is total and stable under every filter combination.
 */
export async function listIssues({
  status,
  category,
  severity,
  q,
  bbox,
  page = 1,
  limit = 20,
} = {}) {
  if (status !== undefined && !ISSUE_STATUSES.includes(status)) {
    throw invalidState(`"${status}" is not a recognized Issue status`, {
      status,
    });
  }
  // Services are also called directly (tests, future callers), bypassing
  // the route's Zod schema, so the new filters are re-checked here against
  // the same definitions rather than trusted.
  if (category !== undefined && !ISSUE_CATEGORY_VALUES.includes(category)) {
    throw validationFailed(`"${category}" is not a recognized Issue category`, { category });
  }
  if (severity !== undefined && !ISSUE_SEVERITY_VALUES.includes(severity)) {
    throw validationFailed(`"${severity}" is not a recognized Issue severity`, { severity });
  }
  if (q !== undefined) {
    const problem = searchTextProblem(q);
    if (problem) throw validationFailed(problem, { q });
  }
  if (bbox !== undefined) {
    const problem = bboxProblem(bbox);
    if (problem) throw validationFailed(problem, { bbox });
  }

  const filter = buildIssueListFilter({ status, category, severity, q, bbox });

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Issue.find(filter)
      .sort({ createdAt: -1, _id: -1 })
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

/**
 * Collects every user id the projections may need to name, from a plain Issue.
 */
function collectActorIds(plain) {
  const ids = [plain.reportedBy];
  for (const h of plain.statusHistory ?? []) ids.push(h.actor);
  if (plain.remediation) ids.push(plain.remediation.actor, plain.remediation.grantedBy);
  for (const e of plain.remediationHistory ?? []) ids.push(e.actor, e.grantee);
  return ids;
}

/** One batched lookup of { name, role } for the given ids (never the whole User). */
async function loadActors(ids) {
  const unique = [...new Set(ids.filter(Boolean).map((id) => String(id._id ?? id)))];
  if (unique.length === 0) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select("_id name role").lean();
  return new Map(users.map((u) => [String(u._id), { name: u.name, role: u.role }]));
}

async function loadIssueForProjection(issueId) {
  let issue;
  try {
    issue = await Issue.findById(issueId);
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }
  if (!issue) throw notFound(`Issue ${issueId} not found`);
  return issue.toObject(); // internal read: private fields intact; projections redact them
}

/**
 * Public activity log for one Issue (ADR-0007 §8): a derived read model over
 * statusHistory + remediationHistory with per-event redaction. No
 * authentication required. Not a route; the routes slice will expose it.
 */
export async function getIssueActivityLog(issueId) {
  const plain = await loadIssueForProjection(issueId);
  const actors = await loadActors(collectActorIds(plain));
  return projectPublicActivityLog(plain, actors);
}

/**
 * Workflow view for an authenticated viewer (ADR-0007 §7): responsibility
 * state, the public assignee, the pending grant (only for role-based viewers,
 * the grantee, or the grantor) and the remediation events this viewer may
 * see. The viewer's role is the CURRENT role supplied by the caller.
 */
export async function getIssueWorkflowView(viewerContext, issueId) {
  requireActor(viewerContext);
  const plain = await loadIssueForProjection(issueId);
  const actors = await loadActors(collectActorIds(plain));
  return projectWorkflowView(plain, viewerContext, actors);
}

// ---------------------------------------------------------------------------
// HTTP view builders (Issue #142). Routes call ONLY these for Issue payloads:
// every result passes through an explicit-allowlist mapper (issue.dto.js).
// ---------------------------------------------------------------------------

/** Public detail: issue + accepted assignee + public activity log. Anonymous. */
export async function getPublicIssueDetail(issueId) {
  const plain = await loadIssueForProjection(issueId);
  const actors = await loadActors(collectActorIds(plain));
  return toPublicIssueDetailDTO(plain, actors, {
    assignee: projectPublicAssignee(plain, actors),
    activity: projectPublicActivityLog(plain, actors),
  });
}

/** Public list page: same pagination envelope as listIssues, items mapped. No activity. */
export async function listPublicIssues(query) {
  const page = await listIssues(query);
  const plains = page.items.map((doc) => doc.toObject());
  const ids = plains.flatMap((p) => [p.reportedBy, ...(p.statusHistory ?? []).map((h) => h.actor)]);
  const actors = await loadActors(ids);
  return { ...page, items: plains.map((p) => toPublicIssueSummaryDTO(p, actors)) };
}

/** Workflow read for the actual authenticated viewer (never shared between viewers). */
export async function getIssueWorkflowDTO(viewerContext, issueId) {
  return toWorkflowDTO(await getIssueWorkflowView(viewerContext, issueId));
}

/**
 * Mutation response for the performing actor: { issue (no activity), workflow }.
 * `doc` is the post-write document returned by the domain service.
 */
export async function buildMutationResult(viewerContext, doc) {
  const plain = doc.toObject();
  const actors = await loadActors(collectActorIds(plain));
  return toMutationDTO(
    toPublicIssueDetailDTO(plain, actors, { assignee: projectPublicAssignee(plain, actors) }),
    toWorkflowDTO(projectWorkflowView(plain, viewerContext, actors)),
  );
}
