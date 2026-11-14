import { Discussion } from "../models/Discussion.js";
import { DiscussionReport } from "../models/DiscussionReport.js";
import "../models/User.js";

import {
  DISCUSSION_REPORT_REASONS,
} from "../domain/discussion-moderation.js";
import { PUBLIC_DISCUSSION_STATUS } from "../domain/discussion.js";
import {
  forbidden,
  invalidState,
  notFound,
  DomainError,
  DomainErrorCode,
  stateRace,
} from "./errors.js";
import { requireActor, requireRole } from "./authorization.js";

const PUBLIC_ACTOR_FIELDS = "_id name role";
const MAX_MODERATION_REASON_LENGTH = 500;

function wrapMongooseValidationError(err) {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, err.message, {
      cause: err.name,
    });
  }

  // Unique report index: concurrent duplicate submissions must still map to
  // the same domain conflict as the normal precondition path.
  if (err.code === 11000) {
    return invalidState("A report for this Discussion has already been submitted");
  }

  return err;
}

function validateReason(reason, required) {
  if (reason === undefined || reason === null) {
    if (required) {
      throw new DomainError(
        DomainErrorCode.VALIDATION_FAILED,
        "moderation reason is required",
        { field: "reason" },
      );
    }
    return null;
  }

  if (typeof reason !== "string") {
    throw new DomainError(
      DomainErrorCode.VALIDATION_FAILED,
      "moderation reason must be a string",
      { field: "reason" },
    );
  }

  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_MODERATION_REASON_LENGTH) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_FAILED,
      "moderation reason must be between 1 and 500 characters",
      { field: "reason" },
    );
  }

  return trimmed;
}

async function findDiscussion(id) {
  try {
    return await Discussion.findById(id);
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }
}

function requireReportReason(reason) {
  if (!DISCUSSION_REPORT_REASONS.includes(reason)) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_FAILED,
      "unrecognized Discussion report reason",
      { field: "reason", value: reason },
    );
  }
}

/**
 * reportDiscussion(actorContext, discussionId, reason)
 *
 * Reporting never changes Discussion visibility. The report is a private,
 * immutable submission owned by the reporter.
 */
export async function reportDiscussion(actorContext, discussionId, reason) {
  requireActor(actorContext);
  requireReportReason(reason);

  const discussion = await findDiscussion(discussionId);
  if (!discussion) {
    throw notFound("Discussion " + discussionId + " not found");
  }

  if (discussion.status !== PUBLIC_DISCUSSION_STATUS) {
    throw notFound("Discussion " + discussionId + " not found");
  }

  if (String(discussion.author) === String(actorContext.id)) {
    throw forbidden("You cannot report your own Discussion");
  }

  const existing = await DiscussionReport.findOne({
    discussion: discussion._id,
    reporter: actorContext.id,
  }).lean();

  if (existing) {
    throw invalidState("A report for this Discussion has already been submitted");
  }

  try {
    return await DiscussionReport.create({
      discussion: discussion._id,
      reporter: actorContext.id,
      reason,
    });
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }
}

/**
 * hideDiscussion(actorContext, discussionId, reason)
 *
 * USER authors may self-hide. ADMIN may hide any ACTIVE Discussion.
 * The status predicate and history push happen in one atomic document update.
 */
export async function hideDiscussion(actorContext, discussionId, reason) {
  requireActor(actorContext);

  const existing = await findDiscussion(discussionId);
  if (!existing) {
    throw notFound("Discussion " + discussionId + " not found");
  }

  const isAdmin = actorContext.role === "ADMIN";
  const isAuthor = String(existing.author) === String(actorContext.id);

  if (!isAdmin && !isAuthor) {
    throw forbidden("You are not authorized to hide this Discussion");
  }

  const normalizedReason = validateReason(reason, isAdmin);
  const action = isAdmin ? "ADMIN_HIDDEN" : "AUTHOR_HIDDEN";

  const updated = await Discussion.findOneAndUpdate(
    { _id: existing._id, status: PUBLIC_DISCUSSION_STATUS },
    {
      $set: { status: "HIDDEN" },
      $push: {
        moderationHistory: {
          actor: actorContext.id,
          action,
          fromStatus: "ACTIVE",
          toStatus: "HIDDEN",
          reason: normalizedReason,
          timestamp: new Date(),
        },
      },
    },
    { new: true, runValidators: true },
  );

  if (!updated) {
    const current = await findDiscussion(discussionId);
    if (!current) {
      throw notFound("Discussion " + discussionId + " not found");
    }
    throw stateRace("Discussion visibility changed concurrently");
  }

  return updated;
}

/**
 * unhideDiscussion(actorContext, discussionId, reason)
 *
 * Only ADMIN can restore public visibility. The status predicate makes the
 * transition conditional and prevents stale concurrent unhide operations.
 */
export async function unhideDiscussion(actorContext, discussionId, reason) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");

  const normalizedReason = validateReason(reason, true);

  const existing = await findDiscussion(discussionId);
  if (!existing) {
    throw notFound("Discussion " + discussionId + " not found");
  }

  const updated = await Discussion.findOneAndUpdate(
    { _id: existing._id, status: "HIDDEN" },
    {
      $set: { status: "ACTIVE" },
      $push: {
        moderationHistory: {
          actor: actorContext.id,
          action: "ADMIN_UNHIDDEN",
          fromStatus: "HIDDEN",
          toStatus: "ACTIVE",
          reason: normalizedReason,
          timestamp: new Date(),
        },
      },
    },
    { new: true, runValidators: true },
  );

  if (!updated) {
    const current = await findDiscussion(discussionId);
    if (!current) {
      throw notFound("Discussion " + discussionId + " not found");
    }
    throw stateRace("Discussion visibility changed concurrently");
  }

  return updated;
}

/**
 * listDiscussionReports(actorContext, pagination)
 *
 * Internal moderation read. Reports remain private and are visible only to
 * ADMIN. No report disposition/status is exposed in MVP.
 */
export async function listDiscussionReports(
  actorContext,
  { page = 1, limit = 20 } = {},
) {
  requireActor(actorContext);
  requireRole(actorContext, "ADMIN");

  const skip = (page - 1) * limit;
  const filter = {};

  const [items, total] = await Promise.all([
    DiscussionReport.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate("reporter", PUBLIC_ACTOR_FIELDS)
      .populate("discussion", "_id title status author"),
    DiscussionReport.countDocuments(filter),
  ]);

  return {
    items: items.map((report) => {
      const plain = report.toObject();
      return {
        _id: String(plain._id),
        reason: plain.reason,
        createdAt: plain.createdAt,
        reporter: plain.reporter,
        discussion: plain.discussion,
      };
    }),
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

