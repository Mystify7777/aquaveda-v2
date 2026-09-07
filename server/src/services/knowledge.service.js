import { Knowledge } from "../models/Knowledge.js";
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
 * Knowledge domain service.
 *
 * Implements createKnowledge, submitForReview, approve, reject, and
 * revise per ADR-0004 (moderation lifecycle) and ADR-0005/0006 (embedded
 * review history, conditional atomic transitions).
 *
 * Same actor-context and validation-boundary assumptions as
 * issue.service.js — see that file's header comment; not repeated here.
 */

function wrapMongooseValidationError(err) {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, err.message, {
      cause: err.name,
    });
  }
  return err;
}

/**
 * createKnowledge(actorContext, payload)
 *
 * payload: { title, body, region? } — never accepts status, author, or
 * reviewHistory from the caller.
 */
export async function createKnowledge(actorContext, payload) {
  requireActor(actorContext);

  try {
    const knowledge = await Knowledge.create({
      title: payload.title,
      body: payload.body,
      region: payload.region,
      author: actorContext.id,
      status: "draft",
      reviewHistory: [],
    });
    return knowledge;
  } catch (err) {
    throw wrapMongooseValidationError(err);
  }
}

/**
 * submitForReview(actorContext, knowledgeId)
 *
 * draft -> pending_review, author-only, no reviewHistory entry appended
 * (submission is not a review decision).
 */
export async function submitForReview(actorContext, knowledgeId) {
  requireActor(actorContext);

  let knowledge;
  try {
    knowledge = await Knowledge.findById(knowledgeId);
  } catch (err) {
    // Malformed knowledgeId -> raw Mongoose CastError, translated to the
    // same DomainError contract as every other failure mode. Once this
    // read succeeds (even with null), the id's shape is confirmed valid
    // for the rest of this function.
    throw wrapMongooseValidationError(err);
  }
  if (!knowledge) {
    throw notFound(`Knowledge ${knowledgeId} not found`);
  }

  if (knowledge.status !== "draft") {
    // Described as a failed state precondition, not coupled to an
    // "invalid transition" specific error name — this is the same
    // INVALID_STATE code used everywhere a document isn't in the state
    // an operation requires, whether or not the concept of a "transition
    // graph" is even the right mental model for that operation.
    throw invalidState(
      `submitForReview requires status "draft", found "${knowledge.status}"`,
      { expected: "draft", actual: knowledge.status },
    );
  }

  if (String(knowledge.author) !== String(actorContext.id)) {
    throw forbidden(
      "only the author may submit a Knowledge article for review",
    );
  }

  const updated = await Knowledge.findOneAndUpdate(
    { _id: knowledgeId, status: "draft" },
    { $set: { status: "pending_review" } },
    { new: true, runValidators: true },
  );

  if (updated) return updated;

  const stillExists = await Knowledge.exists({ _id: knowledgeId });
  if (!stillExists) {
    throw notFound(
      `Knowledge ${knowledgeId} was deleted before submission completed`,
    );
  }
  throw stateRace(
    `Knowledge ${knowledgeId} status changed before submission could be applied`,
    { expectedStatus: "draft", targetStatus: "pending_review" },
  );
}

/**
 * approve(actorContext, knowledgeId)
 *
 * pending_review -> approved. EXPERT only, actor !== author.
 */
export async function approve(actorContext, knowledgeId) {
  requireActor(actorContext);

  let knowledge;
  try {
    knowledge = await Knowledge.findById(knowledgeId);
  } catch (err) {
    // Malformed knowledgeId -> raw Mongoose CastError, translated to the
    // same DomainError contract as every other failure mode. Once this
    // read succeeds (even with null), the id's shape is confirmed valid
    // for the rest of this function.
    throw wrapMongooseValidationError(err);
  }
  if (!knowledge) {
    throw notFound(`Knowledge ${knowledgeId} not found`);
  }

  if (knowledge.status !== "pending_review") {
    throw invalidState(
      `approve requires status "pending_review", found "${knowledge.status}"`,
      { expected: "pending_review", actual: knowledge.status },
    );
  }

  requireRole(actorContext, "EXPERT");

  if (String(knowledge.author) === String(actorContext.id)) {
    throw forbidden("an author may not approve their own Knowledge submission");
  }

  const now = new Date();
  const updated = await Knowledge.findOneAndUpdate(
    { _id: knowledgeId, status: "pending_review" },
    {
      $set: { status: "approved" },
      $push: {
        reviewHistory: {
          decision: "approved",
          reviewer: actorContext.id,
          timestamp: now,
        },
      },
    },
    { new: true, runValidators: true },
  );

  if (updated) return updated;

  const stillExists = await Knowledge.exists({ _id: knowledgeId });
  if (!stillExists) {
    throw notFound(
      `Knowledge ${knowledgeId} was deleted before approval completed`,
    );
  }
  throw stateRace(
    `Knowledge ${knowledgeId} status changed before approval could be applied`,
    { expectedStatus: "pending_review", targetStatus: "approved" },
  );
}

/**
 * reject(actorContext, knowledgeId, feedback)
 *
 * pending_review -> rejected. EXPERT only, actor !== author, feedback
 * required and non-empty.
 */
export async function reject(actorContext, knowledgeId, feedback) {
  requireActor(actorContext);

  let knowledge;
  try {
    knowledge = await Knowledge.findById(knowledgeId);
  } catch (err) {
    // Malformed knowledgeId -> raw Mongoose CastError, translated to the
    // same DomainError contract as every other failure mode. Once this
    // read succeeds (even with null), the id's shape is confirmed valid
    // for the rest of this function.
    throw wrapMongooseValidationError(err);
  }
  if (!knowledge) {
    throw notFound(`Knowledge ${knowledgeId} not found`);
  }

  if (knowledge.status !== "pending_review") {
    throw invalidState(
      `reject requires status "pending_review", found "${knowledge.status}"`,
      { expected: "pending_review", actual: knowledge.status },
    );
  }

  requireRole(actorContext, "EXPERT");

  if (String(knowledge.author) === String(actorContext.id)) {
    throw forbidden("an author may not reject their own Knowledge submission");
  }

  // Feedback is a domain precondition, checked in application code before
  // the write is even attempted — not left solely to Zod (API layer,
  // doesn't exist yet) or the Mongoose subdocument validator (defense in
  // depth, per Knowledge.js's own comment on this exact check).
  if (typeof feedback !== "string" || feedback.trim().length === 0) {
    throw invalidState("rejection requires non-empty feedback", { feedback });
  }

  const now = new Date();
  const updated = await Knowledge.findOneAndUpdate(
    { _id: knowledgeId, status: "pending_review" },
    {
      $set: { status: "rejected" },
      $push: {
        reviewHistory: {
          decision: "rejected",
          reviewer: actorContext.id,
          feedback,
          timestamp: now,
        },
      },
    },
    { new: true, runValidators: true },
  );

  if (updated) return updated;

  const stillExists = await Knowledge.exists({ _id: knowledgeId });
  if (!stillExists) {
    throw notFound(
      `Knowledge ${knowledgeId} was deleted before rejection completed`,
    );
  }
  throw stateRace(
    `Knowledge ${knowledgeId} status changed before rejection could be applied`,
    { expectedStatus: "pending_review", targetStatus: "rejected" },
  );
}

/**
 * revise(actorContext, knowledgeId, updatedContent)
 *
 * rejected -> draft, author-only. Only title/body/region are updatable
 * from `updatedContent` — author, reviewHistory, and status are never
 * accepted from the caller, regardless of what updatedContent contains.
 */
export async function revise(actorContext, knowledgeId, updatedContent) {
  requireActor(actorContext);

  let knowledge;
  try {
    knowledge = await Knowledge.findById(knowledgeId);
  } catch (err) {
    // Malformed knowledgeId -> raw Mongoose CastError, translated to the
    // same DomainError contract as every other failure mode. Once this
    // read succeeds (even with null), the id's shape is confirmed valid
    // for the rest of this function.
    throw wrapMongooseValidationError(err);
  }
  if (!knowledge) {
    throw notFound(`Knowledge ${knowledgeId} not found`);
  }

  if (knowledge.status !== "rejected") {
    throw invalidState(
      `revise requires status "rejected", found "${knowledge.status}"`,
      { expected: "rejected", actual: knowledge.status },
    );
  }

  if (String(knowledge.author) !== String(actorContext.id)) {
    throw forbidden(
      "only the author may revise a rejected Knowledge submission",
    );
  }

  const allowedFields = {};
  if (updatedContent && typeof updatedContent.title === "string") {
    allowedFields.title = updatedContent.title;
  }
  if (updatedContent && typeof updatedContent.body === "string") {
    allowedFields.body = updatedContent.body;
  }
  if (updatedContent && typeof updatedContent.region === "string") {
    allowedFields.region = updatedContent.region;
  }

  const updated = await Knowledge.findOneAndUpdate(
    { _id: knowledgeId, status: "rejected" },
    { $set: { ...allowedFields, status: "draft" } },
    { new: true, runValidators: true },
  );

  if (updated) return updated;

  const stillExists = await Knowledge.exists({ _id: knowledgeId });
  if (!stillExists) {
    throw notFound(
      `Knowledge ${knowledgeId} was deleted before revision completed`,
    );
  }
  throw stateRace(
    `Knowledge ${knowledgeId} status changed before revision could be applied`,
    { expectedStatus: "rejected", targetStatus: "draft" },
  );
}
