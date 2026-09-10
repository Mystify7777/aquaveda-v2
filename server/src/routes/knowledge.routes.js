import { Router } from "express";

import {
  createKnowledge,
  submitForReview,
  approve,
  reject,
  revise,
} from "../services/knowledge.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import {
  createKnowledgeSchema,
  rejectKnowledgeSchema,
  reviseKnowledgeSchema,
} from "../validation/knowledge.validation.js";

/**
 * Knowledge routes.
 *
 * Locked contract: docs/architecture/decision-register.md "Locked —
 * Routes" (ROUTE-L1–L6). Exactly 5 routes, 1:1 with
 * knowledge.service.js's 5 exported operations (ROUTE-L2).
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
