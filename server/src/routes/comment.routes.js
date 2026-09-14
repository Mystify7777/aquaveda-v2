import { Router } from "express";

import { createComment, getCommentThread } from "../services/comment.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import { createCommentSchema, commentThreadQuerySchema } from "../validation/comment.validation.js";

/**
 * Comment routes.
 *
 * Locked contract: docs/architecture/decision-register.md "Locked —
 * Routes" (ROUTE-L1–L6). Exactly 1 route, 1:1 with comment.service.js's
 * 1 exported operation (ROUTE-L2). The router does not decide parent
 * authorization, ownership, or Issue-vs-Knowledge domain rules — all of
 * that stays inside createComment (persistence-design.md §3,
 * D-COMMENT-1). Same conventions as issue.routes.js/knowledge.routes.js.
 *
 * UPDATED (Issue #48): 1 public read route added — GET / (comment
 * thread, via ?refType=&refId= query params, matching the locked v1
 * precedent cited in Comment.js's own schema comment). See
 * issue.routes.js's identical note on ROUTE-L2's amendment.
 */

export const commentRouter = Router();

/**
 * GET /?refType=ISSUE|WIKI&refId=... — public Comment thread read.
 */
commentRouter.get("/", async (req, res) => {
  const parsed = commentThreadQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const thread = await getCommentThread(parsed.data.refType, parsed.data.refId);
    sendSuccess(res, thread, "Comment thread retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

commentRouter.post("/", async (req, res) => {
  const parsed = createCommentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const comment = await createComment(req.actorContext, parsed.data);
    sendSuccess(res, comment, "Comment created", 201);
  } catch (err) {
    sendError(res, err);
  }
});

export default commentRouter;
