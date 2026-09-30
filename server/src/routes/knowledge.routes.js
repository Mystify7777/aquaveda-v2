import { Router } from "express";

import {
  createKnowledge,
  submitForReview,
  approve,
  reject,
  revise,
  listApprovedKnowledge,
  getApprovedKnowledgeById,
  listMyKnowledge,
  listReviewQueue,
  getKnowledgeForWorkflow,
} from "../services/knowledge.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import {
  createKnowledgeSchema,
  rejectKnowledgeSchema,
  reviseKnowledgeSchema,
  listApprovedKnowledgeQuerySchema,
  myKnowledgeQuerySchema,
  reviewQueueQuerySchema,
} from "../validation/knowledge.validation.js";

/**
 * Knowledge routes.
 *
 * Locked contract: docs/architecture/decision-register.md "Locked —
 * Routes" (ROUTE-L1–L6). Exactly 5 routes, 1:1 with
 * knowledge.service.js's 5 exported operations (ROUTE-L2).
 *
 * UPDATED (Issue #48): 2 public read routes added — GET / (list,
 * approved-only) and GET /:knowledgeId (detail, approved-only). See
 * issue.routes.js's identical note on ROUTE-L2's amendment.
 *
 * UPDATED (Issue #74): 3 authenticated workflow read routes added —
 * GET /mine, GET /review-queue, GET /:knowledgeId/workflow. `/mine` and
 * `/review-queue` are registered BEFORE the public GET /:knowledgeId,
 * otherwise Express would capture them as a knowledgeId. Authorization
 * lives in the services (requireActor / requireRole), as for every other
 * route here.
 *
 * `submitForReview` and `approve` take no request body — same pattern
 * as auth.routes.js's `/refresh`/`/logout`/`/me` (cookie/context-driven
 * routes have no Zod schema). `reject` and `revise` do (feedback;
 * partial title/body/region respectively).
 *
 * Same conventions as issue.routes.js — see that file's header comment
 * for the full rationale (thin routing, no requireActor/requireRole
 * here, req.actorContext already resolved by authMiddleware).
 */

export const knowledgeRouter = Router();

/**
 * GET / — public, approved-only Knowledge list.
 */
knowledgeRouter.get("/", async (req, res) => {
  const parsed = listApprovedKnowledgeQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await listApprovedKnowledge(parsed.data);
    sendSuccess(res, result, "Knowledge articles retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /mine — the caller's own Knowledge, every status (Issue #74).
 * MUST stay above GET /:knowledgeId.
 */
knowledgeRouter.get("/mine", async (req, res) => {
  const parsed = myKnowledgeQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await listMyKnowledge(req.actorContext, parsed.data);
    sendSuccess(res, result, "Knowledge retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /review-queue — pending_review Knowledge, EXPERT only (Issue #74).
 * MUST stay above GET /:knowledgeId.
 */
knowledgeRouter.get("/review-queue", async (req, res) => {
  const parsed = reviewQueueQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await listReviewQueue(req.actorContext, parsed.data);
    sendSuccess(res, result, "Review queue retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /:knowledgeId — public, approved-only Knowledge detail.
 */
knowledgeRouter.get("/:knowledgeId", async (req, res) => {
  try {
    const knowledge = await getApprovedKnowledgeById(req.params.knowledgeId);
    sendSuccess(res, knowledge, "Knowledge article retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /:knowledgeId/workflow — full article for its author, or for an
 * EXPERT while it is pending_review (Issue #74). Uniform 404 otherwise.
 */
knowledgeRouter.get("/:knowledgeId/workflow", async (req, res) => {
  try {
    const knowledge = await getKnowledgeForWorkflow(req.actorContext, req.params.knowledgeId);
    sendSuccess(res, knowledge, "Knowledge article retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

knowledgeRouter.post("/", async (req, res) => {
  const parsed = createKnowledgeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const knowledge = await createKnowledge(req.actorContext, parsed.data);
    sendSuccess(res, knowledge, "Knowledge draft created", 201);
  } catch (err) {
    sendError(res, err);
  }
});

knowledgeRouter.post("/:knowledgeId/submit", async (req, res) => {
  try {
    const knowledge = await submitForReview(req.actorContext, req.params.knowledgeId);
    sendSuccess(res, knowledge, "Knowledge submitted for review");
  } catch (err) {
    sendError(res, err);
  }
});

knowledgeRouter.post("/:knowledgeId/approve", async (req, res) => {
  try {
    const knowledge = await approve(req.actorContext, req.params.knowledgeId);
    sendSuccess(res, knowledge, "Knowledge approved");
  } catch (err) {
    sendError(res, err);
  }
});

knowledgeRouter.post("/:knowledgeId/reject", async (req, res) => {
  const parsed = rejectKnowledgeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const knowledge = await reject(
      req.actorContext,
      req.params.knowledgeId,
      parsed.data.feedback,
    );
    sendSuccess(res, knowledge, "Knowledge rejected");
  } catch (err) {
    sendError(res, err);
  }
});

knowledgeRouter.post("/:knowledgeId/revise", async (req, res) => {
  const parsed = reviseKnowledgeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const knowledge = await revise(req.actorContext, req.params.knowledgeId, parsed.data);
    sendSuccess(res, knowledge, "Knowledge revised");
  } catch (err) {
    sendError(res, err);
  }
});

export default knowledgeRouter;
