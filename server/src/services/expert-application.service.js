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
 * and reviewer identity come from `actorContext`; the only client input
 * is the target user id (approve/reject) and an optional rejection note.
 */

function wrapCastError(err) {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, err.message, {
      cause: err.name,
    });
  }
  return err;
}

const lastEntry = (app) => app?.history?.[app.history.length - 1];

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
      timestamp: h.timestamp,
    })),
  };
}

/** Reviewer-facing: includes the actor of each transition. */
function toReviewerDTO(user) {
  const app = user.expertApplication;
  return {
    userId: String(user._id),
    name: user.name,
    bio: user.bio,
    status: app.status,
    requestedAt: lastEntry(app)?.timestamp,
    history: app.history.map((h) => ({
      fromStatus: h.fromStatus ?? null,
      toStatus: h.toStatus,
      actor: String(h.actor),
      note: h.note,
      timestamp: h.timestamp,
    })),
  };
}

/**
 * applyForExpert(actorContext)
 *
 * none | rejected -> pending. USER only.
 */
export async function applyForExpert(actorContext) {
  requireActor(actorContext);
  requireRole(actorContext, "USER");

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
    timestamp: new Date(),
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

async function decide(actorContext, applicantId, decision, note) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");

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

  const approved = decision === "approve";
  const toStatus = approved ? "approved" : "rejected";
  const entry = {
    fromStatus: "pending",
    toStatus,
    actor: actorContext.id,
    timestamp: new Date(),
    ...(note ? { note } : {}),
  };

  let updated;
  try {
    updated = await User.findOneAndUpdate(
      { _id: applicantId, role: "USER", "expertApplication.status": "pending" },
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
  });
}

/** approveExpertApplication(actorContext, applicantId) — pending -> approved, grants EXPERT. ADMIN only. */
export const approveExpertApplication = (actorContext, applicantId) =>
  decide(actorContext, applicantId, "approve");

/** rejectExpertApplication(actorContext, applicantId, note?) — pending -> rejected. ADMIN only. */
export const rejectExpertApplication = (actorContext, applicantId, note) =>
  decide(actorContext, applicantId, "reject", note);
