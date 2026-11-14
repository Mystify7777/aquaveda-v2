import { Discussion } from "../models/Discussion.js";
import "../models/User.js";

import {
  notFound,
  DomainError,
  DomainErrorCode,
} from "./errors.js";
import { requireActor } from "./authorization.js";
import {
  DISCUSSION_CATEGORIES,
  PUBLIC_DISCUSSION_STATUS,
} from "../domain/discussion.js";

const PUBLIC_ACTOR_FIELDS = "_id name role";

function wrapMongooseValidationError(err) {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, err.message, {
      cause: err.name,
    });
  }
  return err;
}

function validateCreatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new DomainError(
      DomainErrorCode.VALIDATION_FAILED,
      "Discussion payload is required",
    );
  }

  if (typeof payload.title !== "string" || payload.title.trim().length === 0) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_FAILED,
      "title is required",
      { field: "title" },
    );
  }

  if (typeof payload.body !== "string" || payload.body.trim().length === 0) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_FAILED,
      "body is required",
      { field: "body" },
    );
  }

  if (!DISCUSSION_CATEGORIES.includes(payload.category)) {
    throw new DomainError(
      DomainErrorCode.VALIDATION_FAILED,
      "unrecognized Discussion category",
      { field: "category", value: payload.category },
    );
  }
}

/**
 * createDiscussion(actorContext, payload)
 *
 * Clients may supply only title/body/category. Author, status and timestamps
 * are server-owned.
 */
export async function createDiscussion(actorContext, payload) {
  requireActor(actorContext);
  validateCreatePayload(payload);

  try {
    return await Discussion.create({
      title: payload.title.trim(),
      body: payload.body.trim(),
      category: payload.category,
      author: actorContext.id,
      status: PUBLIC_DISCUSSION_STATUS,
    });
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }
}

/**
 * listPublicDiscussions({ page, limit })
 *
 * Anonymous-accessible public read. Hidden Discussions are filtered at the
 * database boundary and therefore cannot leak into the public projection.
 */
export async function listPublicDiscussions({ page = 1, limit = 20 } = {}) {
  const filter = { status: PUBLIC_DISCUSSION_STATUS };
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Discussion.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate("author", PUBLIC_ACTOR_FIELDS),
    Discussion.countDocuments(filter),
  ]);

  return {
    items,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

/**
 * getPublicDiscussionById(id)
 *
 * Public detail deliberately uses the same NOT_FOUND boundary for malformed
 * ids (translated to validation failure), nonexistent ids, and HIDDEN ids.
 * A well-formed hidden id is indistinguishable from a nonexistent public id.
 */
export async function getPublicDiscussionById(id) {
  let discussion;
  try {
    discussion = await Discussion.findOne({
      _id: id,
      status: PUBLIC_DISCUSSION_STATUS,
    }).populate("author", PUBLIC_ACTOR_FIELDS);
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }

  if (!discussion) {
    throw notFound("Discussion " + id + " not found");
  }

  return discussion;
}
