import { Comment } from "../models/Comment.js";
import { Issue } from "../models/Issue.js";
import { Knowledge } from "../models/Knowledge.js";
// Model-registration side effect only — see issue.service.js's
// identical import for the full explanation.
import "../models/User.js";
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

// Public-read attribution: name/role only. See issue.service.js's
// identical constant for the full rationale.
const PUBLIC_ACTOR_FIELDS = "_id name role";

// A safety bound, not a caller-controlled page/limit — see
// getCommentThread's own comment for why threads aren't paginated.
const MAX_THREAD_COMMENTS = 500;

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

/**
 * getCommentThread(refType, refId) — public, Issue #48.
 *
 * Fetches the full (refType, refId) thread in one query via the
 * existing compound index, then groups top-level comments and their
 * (at most one level of) replies in this function — exactly the plan
 * Comment.js's own schema comment already documented ("no
 * parentComment index... all currently planned reads go through the
 * (refType, refId) index and group replies in the response layer").
 * This is that response layer.
 *
 * Returns TARGET_NOT_FOUND if refId doesn't resolve to a real
 * Issue/Knowledge document — reusing targetExists(), the same check
 * createComment() already performs, so read and write agree on what
 * counts as a valid target. No requireActor() call — genuinely
 * anonymous-accessible, matching Explore/Learn's public read boundary.
 *
 * Correction (post-implementation review): for WIKI targets, existence
 * alone is not sufficient for public visibility — a WIKI thread is
 * only readable when its Knowledge article is approved (same
 * TARGET_NOT_FOUND used uniformly, so a private article's existence is
 * never disclosed via its comment thread). See the inline comment at
 * the WIKI branch below for the full reasoning, including why
 * targetExists() itself was deliberately left unmodified.
 *
 * No pagination: MAX_THREAD_COMMENTS is a fixed safety bound, not a
 * caller-controlled parameter — nothing in the current product plan
 * calls for paging within a single thread, and inventing that control
 * now would be speculative.
 */
export async function getCommentThread(refType, refId) {
  if (!SUPPORTED_REF_TYPES.includes(refType)) {
    throw invalidState(`"${refType}" is not a supported Comment refType`, {
      refType,
    });
  }

  const exists = await targetExists(refType, refId);
  if (!exists) {
    throw targetNotFound(
      `no ${refType} document found for refId ${refId}`,
      { refType, refId },
    );
  }

  /**
   * Correction (Issue #48 review): targetExists() only proves the
   * Knowledge document exists — it says nothing about whether it's
   * approved. Left deliberately untouched here (not modified
   * globally) because createComment's write path also calls it, and
   * is allowed to attach a comment to a non-approved Knowledge
   * article (unchanged, pre-existing behavior — e.g. an author or
   * reviewer discussing a draft). The public *read* path is a
   * separate visibility question: a WIKI thread must only be
   * anonymously readable when its Knowledge article is approved,
   * exactly mirroring getApprovedKnowledgeById's own rule. By the
   * time this runs, targetExists() has already proven refId is a
   * syntactically valid ObjectId (it throws its own translated
   * CastError otherwise), so no additional cast-error handling is
   * needed here.
   */
  if (refType === "WIKI") {
    const knowledge = await Knowledge.findById(refId).select("status").lean();
    if (!knowledge || knowledge.status !== "approved") {
      // Same TARGET_NOT_FOUND as a genuinely nonexistent target —
      // deliberately indistinguishable. Returning a different error
      // here (e.g. FORBIDDEN) would confirm to an anonymous caller
      // that a specific draft/pending_review/rejected article exists,
      // exactly the disclosure Issue #48's own constraints forbid.
      throw targetNotFound(
        `no ${refType} document found for refId ${refId}`,
        { refType, refId },
      );
    }
  }

  const allComments = await Comment.find({ refType, refId })
    .sort({ createdAt: 1 })
    .limit(MAX_THREAD_COMMENTS)
    .populate("author", PUBLIC_ACTOR_FIELDS);

  const repliesByParentId = new Map();
  const topLevel = [];

  for (const comment of allComments) {
    if (comment.parentComment) {
      const key = String(comment.parentComment);
      if (!repliesByParentId.has(key)) {
        repliesByParentId.set(key, []);
      }
      repliesByParentId.get(key).push(comment);
    } else {
      topLevel.push(comment);
    }
  }

  return topLevel.map((comment) => {
    const plain = comment.toObject();
    plain.replies = (repliesByParentId.get(String(comment._id)) ?? []).map(
      (reply) => reply.toObject(),
    );
    return plain;
  });
}
