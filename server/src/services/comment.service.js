import { Comment } from "../models/Comment.js";
import { Issue } from "../models/Issue.js";
import { Knowledge } from "../models/Knowledge.js";
import {
  invalidState,
  invalidParent,
  targetNotFound,
  DomainError,
  DomainErrorCode,
} from "./errors.js";
import { requireActor } from "./authorization.js";

/**
 * Comment domain service.
 *
 * Implements createComment. Comment is a shared primitive attached to
 * either an Issue or a Knowledge article via the `refType`/`refId`
 * discriminator (persistence-design.md §3).
 *
 * D-COMMENT-1 (now locked, per the Phase D contract): a reply must target
 * the exact same (refType, refId) pair as its parent. Replying to a reply
 * is also rejected (one level of nesting only).
 */

const SUPPORTED_REF_TYPES = ["ISSUE", "WIKI"];

function wrapMongooseValidationError(err) {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, err.message, {
      cause: err.name,
    });
  }
  return err;
}

async function targetExists(refType, refId) {
  try {
    if (refType === "ISSUE") {
      return Boolean(await Issue.exists({ _id: refId }));
    }
    if (refType === "WIKI") {
      return Boolean(await Knowledge.exists({ _id: refId }));
    }
    return false;
  } catch (err) {
    // A malformed refId throws a raw Mongoose CastError here — translated
    // to the same DomainError contract as every other failure mode.
    throw wrapMongooseValidationError(err);
  }
}

/**
 * createComment(actorContext, payload)
 *
 * payload: { refType, refId, body, parentComment? }
 */
export async function createComment(actorContext, payload) {
  requireActor(actorContext);

  if (!SUPPORTED_REF_TYPES.includes(payload.refType)) {
    throw invalidState(
      `"${payload.refType}" is not a supported Comment refType`,
      { refType: payload.refType },
    );
  }

  const exists = await targetExists(payload.refType, payload.refId);
  if (!exists) {
    throw targetNotFound(
      `no ${payload.refType} document found for refId ${payload.refId}`,
      { refType: payload.refType, refId: payload.refId },
    );
  }

  if (payload.parentComment) {
    let parent;
    try {
      parent = await Comment.findById(payload.parentComment);
    } catch (err) {
      // parentComment is a separate caller-supplied id from refId — a
      // malformed value here is independent of whether refId was valid,
      // so it needs its own wrap.
      throw wrapMongooseValidationError(err);
    }
    if (!parent) {
      throw invalidParent(
        `parentComment ${payload.parentComment} does not exist`,
      );
    }

    if (parent.parentComment) {
      // One level of nesting only — a reply cannot itself be replied to.
      throw invalidParent("cannot reply to a comment that is itself a reply", {
        parentComment: payload.parentComment,
      });
    }

    // D-COMMENT-1: the reply must target the exact same (refType, refId)
    // pair as its parent. A parent on ISSUE/A cannot be replied to from
    // a comment declaring ISSUE/B or WIKI/A.
    const sameRefType = parent.refType === payload.refType;
    const sameRefId = String(parent.refId) === String(payload.refId);
    if (!sameRefType || !sameRefId) {
      throw invalidParent(
        "a reply must target the same (refType, refId) as its parent comment",
        {
          parent: { refType: parent.refType, refId: parent.refId },
          reply: { refType: payload.refType, refId: payload.refId },
        },
      );
    }
  }

  try {
    const comment = await Comment.create({
      refType: payload.refType,
      refId: payload.refId,
      author: actorContext.id,
      body: payload.body,
      parentComment: payload.parentComment ?? null,
    });
    return comment;
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }
}
