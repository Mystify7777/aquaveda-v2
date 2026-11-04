import mongoose from "mongoose";

import { Issue } from "../models/Issue.js";
import { User } from "../models/User.js";
import { resolveSelfGrantThreshold } from "../config/env.js";
import { parseNote } from "../domain/lifecycle-note.js";
import { GRANT_OPERATION_STATUSES, selfGrantPermitted } from "../domain/remediation.js";
import { requireActor, requireRole } from "./authorization.js";
import { DomainError, DomainErrorCode, forbidden, invalidState, notFound, stateRace } from "./errors.js";

/**
 * Remediation grant operations (ADR-0007). Domain service: it receives an
 * opaque `actorContext = { id, role }` and never decodes tokens.
 *
 * A grant is the ONLY source of remediation authority (the authority to move
 * an Issue `acknowledged → in_progress → resolved` lives in
 * issue.service.js `changeStatus`, which checks the accepted grant). Grant
 * operations never change `Issue.status`.
 *
 * Every operation follows the same shape (ADR-0006 / ADR-0007 §4):
 *   pre-read → ordered checks → conditional atomic write → zero-match re-read.
 *
 *  - Every write that depends on a grant pins the EXACT grant observed in the
 *    pre-read (`remediation.grantId`), so a stale operation can never act on a
 *    replacement grant, even one issued to the same user (ABA).
 *  - Each write is ONE document update that changes `remediation` and appends
 *    exactly one `remediationHistory` event (no transactions needed).
 *  - A zero-match write NEVER reports FORBIDDEN: a stale snapshot cannot prove
 *    the actor lacked authority. It re-reads and reports NOT_FOUND or STATE_RACE.
 *  - Check order never reveals private grant state (ADR-0007 §7): grantee-only
 *    operations answer FORBIDDEN uniformly to anyone who is not the current
 *    grantee, whether or not a grant exists.
 *  - Operations are not idempotent: a repeated one is INVALID_STATE/STATE_RACE.
 */

const validationFailed = (message, details) =>
  new DomainError(DomainErrorCode.VALIDATION_FAILED, message, details);

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const STATUSES = [...GRANT_OPERATION_STATUSES];

async function loadIssue(issueId) {
  let issue;
  try {
    issue = await Issue.findById(issueId);
  } catch (err) {
    if (err.name === "CastError" || err.name === "ValidationError") {
      throw validationFailed(err.message, { cause: err.name });
    }
    throw err;
  }
  if (!issue) throw notFound(`Issue ${issueId} not found`);
  return issue;
}

function assertGrantStatus(issue) {
  if (!GRANT_OPERATION_STATUSES.includes(issue.status)) {
    throw invalidState(`remediation grants cannot be changed while the issue is ${issue.status}`, {
      status: issue.status,
    });
  }
}

function parseOptionalNote(note, { required = false } = {}) {
  const parsed = parseNote(note, { required });
  if (!parsed.ok) throw validationFailed(parsed.problem, { field: "note" });
  return parsed.value;
}

function event({ type, grant, actor, grantee, now, note, extra }) {
  return {
    type,
    grantId: grant.grantId,
    actor,
    grantee,
    timestamp: now,
    ...(note !== undefined ? { note } : {}),
    ...(extra ?? {}),
  };
}

/** Conditional write + zero-match disambiguation (never FORBIDDEN). */
async function writeIfUnchanged(issueId, filter, update) {
  const updated = await Issue.findOneAndUpdate(filter, update, { new: true, runValidators: true });
  if (updated) return updated;
  const stillExists = await Issue.exists({ _id: issueId });
  if (!stillExists) throw notFound(`Issue ${issueId} was deleted before the operation completed`);
  throw stateRace(`Issue ${issueId} or its remediation grant changed before this operation could be applied`);
}

/** The pre-read check shared by accept / decline / release: the actor must be the CURRENT grantee. */
function requireCurrentGrantee(issue, actorContext) {
  const grant = issue.remediation;
  if (!grant || String(grant.actor) !== String(actorContext.id)) {
    throw forbidden("only the grantee of the current remediation grant may perform this operation");
  }
  return grant;
}

/**
 * grantRemediation — EXPERT only. Creates a PENDING grant for `granteeId`.
 * Self-grant (grantee === actor) is allowed only while the EXPERT pool is
 * below SELF_GRANT_EXPERT_THRESHOLD (ADR-0007 §2); the expert count is a
 * policy input read here, not part of the atomic filter (documented limit).
 */
export async function grantRemediation(actorContext, issueId, granteeId, { note } = {}) {
  requireActor(actorContext);
  requireRole(actorContext, "EXPERT");

  const grantee = String(granteeId?._id ?? granteeId ?? "");
  if (!OBJECT_ID.test(grantee)) {
    throw validationFailed("granteeId must be a valid id", { field: "granteeId" });
  }

  const issue = await loadIssue(issueId);
  assertGrantStatus(issue);
  if (issue.remediation) {
    throw invalidState("this issue already has a remediation grant", { reason: "GRANT_EXISTS" });
  }
  if (!(await User.exists({ _id: grantee }))) {
    throw notFound("grantee not found", { resource: "user" });
  }

  let selfBasis;
  if (grantee === String(actorContext.id)) {
    // Counted ONLY on the self-grant path: ordinary grants pay nothing.
    const expertCount = await User.countDocuments({ role: "EXPERT" });
    const threshold = resolveSelfGrantThreshold();
    if (!selfGrantPermitted({ expertCount, threshold })) {
      throw forbidden("self-grant is not permitted at the current expert pool size", {
        reason: "SELF_GRANT_NOT_PERMITTED",
        expertCount,
        threshold,
      });
    }
    selfBasis = { selfGrant: true, expertCount, threshold };
  }

  const parsedNote = parseOptionalNote(note);
  const grantId = new mongoose.Types.ObjectId();
  const now = new Date();

  return writeIfUnchanged(
    issueId,
    { _id: issueId, status: { $in: STATUSES }, remediation: { $exists: false } },
    {
      $set: { remediation: { grantId, actor: grantee, grantedBy: actorContext.id, grantedAt: now, acceptedAt: null } },
      $push: {
        remediationHistory: event({
          type: "granted",
          grant: { grantId },
          actor: actorContext.id,
          grantee,
          now,
          note: parsedNote,
          extra: selfBasis,
        }),
      },
    },
  );
}

/** acceptRemediation — the current grantee only; the grant must be pending. */
export async function acceptRemediation(actorContext, issueId) {
  requireActor(actorContext);
  const issue = await loadIssue(issueId);
  const grant = requireCurrentGrantee(issue, actorContext);
  assertGrantStatus(issue);
  if (grant.acceptedAt) {
    throw invalidState("this remediation grant was already accepted", { reason: "GRANT_ALREADY_ACCEPTED" });
  }

  const now = new Date();
  return writeIfUnchanged(
    issueId,
    {
      _id: issueId,
      status: { $in: STATUSES },
      "remediation.grantId": grant.grantId,
      "remediation.actor": actorContext.id,
      "remediation.acceptedAt": null,
    },
    {
      $set: { "remediation.acceptedAt": now },
      $push: {
        remediationHistory: event({ type: "accepted", grant, actor: actorContext.id, grantee: actorContext.id, now }),
      },
    },
  );
}

/** declineRemediation — the current grantee only; the grant must still be pending. Removes the grant. */
export async function declineRemediation(actorContext, issueId, { note } = {}) {
  requireActor(actorContext);
  const issue = await loadIssue(issueId);
  const grant = requireCurrentGrantee(issue, actorContext);
  assertGrantStatus(issue);
  if (grant.acceptedAt) {
    throw invalidState("an accepted grant is released, not declined", { reason: "GRANT_ALREADY_ACCEPTED" });
  }
  const parsedNote = parseOptionalNote(note);

  const now = new Date();
  return writeIfUnchanged(
    issueId,
    {
      _id: issueId,
      status: { $in: STATUSES },
      "remediation.grantId": grant.grantId,
      "remediation.actor": actorContext.id,
      "remediation.acceptedAt": null,
    },
    {
      $unset: { remediation: "" },
      $push: {
        remediationHistory: event({
          type: "declined",
          grant,
          actor: actorContext.id,
          grantee: actorContext.id,
          now,
          note: parsedNote,
        }),
      },
    },
  );
}

/** releaseRemediation — the current grantee only; the grant must be accepted. Removes the grant. */
export async function releaseRemediation(actorContext, issueId, { note } = {}) {
  requireActor(actorContext);
  const issue = await loadIssue(issueId);
  const grant = requireCurrentGrantee(issue, actorContext);
  assertGrantStatus(issue);
  if (!grant.acceptedAt) {
    throw invalidState("a pending grant is declined, not released", { reason: "GRANT_NOT_ACCEPTED" });
  }
  const parsedNote = parseOptionalNote(note);

  const now = new Date();
  return writeIfUnchanged(
    issueId,
    {
      _id: issueId,
      status: { $in: STATUSES },
      "remediation.grantId": grant.grantId,
      "remediation.actor": actorContext.id,
      "remediation.acceptedAt": { $ne: null },
    },
    {
      $unset: { remediation: "" },
      $push: {
        remediationHistory: event({
          type: "released",
          grant,
          actor: actorContext.id,
          grantee: actorContext.id,
          now,
          note: parsedNote,
        }),
      },
    },
  );
}

async function removeGrantByAuthority({ actorContext, issueId, note, role, type }) {
  requireActor(actorContext);
  requireRole(actorContext, role);
  const issue = await loadIssue(issueId);
  assertGrantStatus(issue);
  const grant = issue.remediation;
  if (!grant) {
    throw invalidState("this issue has no remediation grant", { reason: "NO_GRANT" });
  }
  const parsedNote = parseOptionalNote(note, { required: true });

  const now = new Date();
  return writeIfUnchanged(
    issueId,
    { _id: issueId, status: { $in: STATUSES }, "remediation.grantId": grant.grantId },
    {
      $unset: { remediation: "" },
      $push: {
        remediationHistory: event({
          type,
          grant,
          actor: actorContext.id,
          grantee: grant.actor,
          now,
          note: parsedNote,
        }),
      },
    },
  );
}

/** withdrawRemediation — any EXPERT; pending or accepted; reason (note) required. */
export function withdrawRemediation(actorContext, issueId, { note } = {}) {
  return removeGrantByAuthority({ actorContext, issueId, note, role: "EXPERT", type: "withdrawn" });
}

/** revokeRemediation — ADMIN (governance only); pending or accepted; reason (note) required. */
export function revokeRemediation(actorContext, issueId, { note } = {}) {
  return removeGrantByAuthority({ actorContext, issueId, note, role: "ADMIN", type: "revoked" });
}
