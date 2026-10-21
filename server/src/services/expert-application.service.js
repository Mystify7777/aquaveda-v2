import { createHash } from "node:crypto";

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
  ACKNOWLEDGEMENT_TEXTS,
  isValidRevision,
  validateDecisionNote,
  validateSubmission,
} from "../domain/expert-application-submission.js";

/**
 * Expert-application domain service (#91).
 *
 * Establishes the only path by which EXPERT authority is acquired:
 *
 *   USER --apply--> pending --ADMIN approve--> EXPERT
 *                           \--ADMIN reject--> rejected --apply--> pending
 *
 * Authority split (Product Invariant 9): ADMIN governs who becomes an
 * Expert; EXPERT verifies Issues/Knowledge. Reviewer authority is
 * `requireRole(ctx, "ADMIN")` — single role, never ADMIN||EXPERT
 * (AUTH-L2). See decision-register "Locked — Expert Authority (#91)".
 *
 * Persistence: embedded `User.expertApplication` (status + append-only
 * history incl. the initial null -> pending entry). Approval flips
 * `role` and `expertApplication.status` in a single conditional atomic
 * write (ADR-0006), so they cannot diverge. No transaction.
 *
 * Callers never supply role, applicant, reviewer, or status: applicant
 * and reviewer identity come from `actorContext`. Client input is the
 * application submission (apply), and the target user id + the `revision`
 * the reviewer saw + a note (approve/reject).
 *
 * Submission (EXP-L9+): stored on the `-> pending` history entry, so every
 * attempt keeps what was submitted. The acknowledgement hash is computed
 * HERE from the retained immutable text for the submitted version; the client
 * only supplies the version.
 *
 * Revision pinning (EXP-L10+): `revision` = history.length the reviewer saw.
 * The decision write filters on it atomically (`$size`), so a decision can
 * never land on a newer submission than the one reviewed.
 */

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const validationFailed = (message, details) =>
  new DomainError(DomainErrorCode.VALIDATION_FAILED, message, details);

function wrapCastError(err) {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, err.message, {
      cause: err.name,
    });
  }
  return err;
}

const lastEntry = (app) => app?.history?.[app.history.length - 1];

/** Latest `-> pending` entry (the submission a reviewer decides on). */
const latestPendingEntry = (app) =>
  [...(app?.history ?? [])].reverse().find((h) => h.toStatus === "pending");

/** Client-facing submission: no hash (an internal audit fact). `null` = legacy. */
function toSubmissionDTO(sub) {
  if (!sub) return null;
  return {
    expertiseAreas: [...(sub.expertiseAreas ?? [])],
    experience: sub.experience,
    ...(sub.affiliation ? { affiliation: sub.affiliation } : {}),
    references: [...(sub.references ?? [])],
    ...(sub.acknowledgement
      ? {
          acknowledgement: {
            version: sub.acknowledgement.version,
            acceptedAt: sub.acknowledgement.acceptedAt,
          },
        }
      : {}),
  };
}

/** `submission` key only on `-> pending` entries (object, or null for legacy). */
function entrySubmission(h) {
  return h.toStatus === "pending" ? { submission: toSubmissionDTO(h.submission) } : {};
}

/** Applicant-facing: no reviewer identity. */
function toApplicantDTO(user) {
  const app = user.expertApplication;
  if (!app) return { status: "none", history: [] };
  return {
    status: app.status,
    history: app.history.map((h) => ({
      fromStatus: h.fromStatus ?? null,
      toStatus: h.toStatus,
      note: h.note,
      ...entrySubmission(h),
      timestamp: h.timestamp,
    })),
  };
}

/**
 * Reviewer-facing: includes the actor of each transition.
 * `revision` and `submission` are derived from the SAME history array of the
 * SAME read, so they describe one snapshot by construction: for a pending
 * application the last entry is always its `-> pending` entry (status changes
 * only by appending an entry, EXP-L3), hence `revision` identifies exactly the
 * entry whose submission is returned.
 */
function toReviewerDTO(user) {
  const app = user.expertApplication;
  return {
    userId: String(user._id),
    name: user.name,
    bio: user.bio,
    status: app.status,
    requestedAt: lastEntry(app)?.timestamp,
    revision: app.history.length,
    submission: toSubmissionDTO(latestPendingEntry(app)?.submission),
    history: app.history.map((h) => ({
      fromStatus: h.fromStatus ?? null,
      toStatus: h.toStatus,
      actor: String(h.actor),
      note: h.note,
      ...entrySubmission(h),
      timestamp: h.timestamp,
    })),
  };
}

/**
 * applyForExpert(actorContext, submissionInput)
 *
 * none | rejected -> pending, carrying the validated submission on the new
 * history entry. USER only. Validation runs HERE as well as at the route so
 * direct service callers (tests, future jobs) cannot persist an invalid one.
 */
export async function applyForExpert(actorContext, submissionInput) {
  requireActor(actorContext);
  requireRole(actorContext, "USER");

  const checked = validateSubmission(submissionInput);
  if (!checked.ok) throw validationFailed("invalid expert application", { fields: checked.errors });
  const { acknowledgement, ...submission } = checked.value;
  const acknowledgementVersion = acknowledgement.version;
  const now = new Date();

  let user;
  try {
    user = await User.findById(actorContext.id);
  } catch (err) {
    throw wrapCastError(err);
  }
  if (!user) throw notFound("applicant not found");

  const status = user.expertApplication?.status;
  if (status === "pending" || status === "approved") {
    throw invalidState(`cannot apply: application is already "${status}"`, {
      actual: status,
    });
  }
  // Role in the token can be stale; the stored role is authoritative.
  if (user.role !== "USER") {
    throw forbidden("Forbidden: insufficient role privileges", {
      requiredRole: "USER",
      actualRole: user.role,
    });
  }

  const filter = {
    _id: actorContext.id,
    role: "USER",
    ...(status === "rejected"
      ? { "expertApplication.status": "rejected" }
      : { expertApplication: { $exists: false } }),
  };
  const entry = {
    fromStatus: status ?? null,
    toStatus: "pending",
    actor: actorContext.id,
    timestamp: now,
    submission: {
      ...submission,
      acknowledgement: {
        version: acknowledgementVersion,
        textSha256: sha256(ACKNOWLEDGEMENT_TEXTS[acknowledgementVersion]),
        acceptedAt: now,
      },
    },
  };
  const update =
    status === "rejected"
      ? {
          $set: { "expertApplication.status": "pending" },
          $push: { "expertApplication.history": entry },
        }
      : { $set: { expertApplication: { status: "pending", history: [entry] } } };

  const updated = await User.findOneAndUpdate(filter, update, {
    new: true,
    runValidators: true,
  });
  if (updated) return toApplicantDTO(updated);

  throw stateRace("expert application state changed concurrently; retry", {
    expected: status ?? "none",
  });
}

/**
 * getMyExpertApplication(actorContext) — the caller's own application.
 * `{ status: "none" }` when never applied.
 */
export async function getMyExpertApplication(actorContext) {
  requireActor(actorContext);
  let user;
  try {
    user = await User.findById(actorContext.id).select("expertApplication").lean();
  } catch (err) {
    throw wrapCastError(err);
  }
  if (!user) throw notFound("user not found");
  return toApplicantDTO(user);
}

/**
 * listPendingExpertApplications(actorContext, { page, limit }) — ADMIN only.
 * Oldest-first by `updatedAt` (a pending user has no other writers today).
 */
export async function listPendingExpertApplications(actorContext, { page = 1, limit = 20 } = {}) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");

  const filter = { "expertApplication.status": "pending", role: "USER" };
  const [items, total] = await Promise.all([
    User.find(filter)
      .select("name bio expertApplication")
      .sort({ updatedAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return {
    items: items.map(toReviewerDTO),
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

/**
 * The production decision predicate (EXP-L10+): expected status AND the exact
 * revision (history length) in ONE query, so MongoDB evaluates both atomically
 * with the update. Exported so tests exercise this exact shape, not a copy.
 */
export function decisionFilter(applicantId, revision) {
  return {
    _id: applicantId,
    role: "USER",
    "expertApplication.status": "pending",
    "expertApplication.history": { $size: revision },
  };
}

async function decide(actorContext, applicantId, decision, { revision, note } = {}) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");

  if (!isValidRevision(revision)) {
    throw validationFailed("revision must be the integer revision of the application you reviewed");
  }
  const checkedNote = validateDecisionNote(note, { required: decision === "reject" });
  if (!checkedNote.ok) throw validationFailed(checkedNote.reason, { field: "note" });

  let target;
  try {
    target = await User.findById(applicantId).select("role expertApplication").lean();
  } catch (err) {
    throw wrapCastError(err);
  }
  if (!target || !target.expertApplication) {
    throw notFound(`Expert application for user ${applicantId} not found`);
  }
  if (String(target._id) === String(actorContext.id)) {
    throw forbidden("a reviewer may not decide their own application");
  }
  if (target.expertApplication.status !== "pending") {
    throw invalidState(
      `${decision} requires status "pending", found "${target.expertApplication.status}"`,
      { expected: "pending", actual: target.expertApplication.status },
    );
  }
  // Early, readable error only. The authoritative guard is the atomic filter below.
  if (target.expertApplication.history.length !== revision) {
    throw stateRace("expert application changed since you reviewed it; review the latest version", {
      expectedRevision: revision,
      currentRevision: target.expertApplication.history.length,
    });
  }

  const approved = decision === "approve";
  const toStatus = approved ? "approved" : "rejected";
  const entry = {
    fromStatus: "pending",
    toStatus,
    actor: actorContext.id,
    timestamp: new Date(),
    ...(checkedNote.value ? { note: checkedNote.value } : {}),
  };

  let updated;
  try {
    // ONE atomic conditional write: expected status AND the exact revision
    // (history length) the reviewer saw. Zero match => STATE_RACE; never
    // retried against a newer revision, never reported as success.
    updated = await User.findOneAndUpdate(
      decisionFilter(applicantId, revision),
      {
        $set: {
          "expertApplication.status": toStatus,
          ...(approved ? { role: "EXPERT" } : {}),
        },
        $push: { "expertApplication.history": entry },
      },
      { new: true, runValidators: true },
    );
  } catch (err) {
    throw wrapCastError(err);
  }
  if (updated) return toReviewerDTO(updated);

  throw stateRace("expert application state changed concurrently; retry", {
    expected: "pending",
    expectedRevision: revision,
  });
}

/** approveExpertApplication(actorContext, applicantId, { revision, note? }) — pending -> approved, grants EXPERT. ADMIN only. */
export const approveExpertApplication = (actorContext, applicantId, input) =>
  decide(actorContext, applicantId, "approve", input);

/** rejectExpertApplication(actorContext, applicantId, { revision, note }) — pending -> rejected. ADMIN only. */
export const rejectExpertApplication = (actorContext, applicantId, input) =>
  decide(actorContext, applicantId, "reject", input);
