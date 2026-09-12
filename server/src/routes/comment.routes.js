import { Router } from "express";

import { createComment } from "../services/comment.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import { createCommentSchema } from "../validation/comment.validation.js";

/**
 * Comment routes.
 *
 * Locked contract: docs/architecture/decision-register.md "Locked —
 * Routes" (ROUTE-L1–L6). Exactly 1 route, 1:1 with comment.service.js's
 * 1 exported operation (ROUTE-L2). The router does not decide parent
 * authorization, ownership, or Issue-vs-Knowledge domain rules — all of
 * that stays inside createComment (persistence-design.md §3,
 * D-COMMENT-1). Same conventions as issue.routes.js/knowledge.routes.js.
 */

export const commentRouter = Router();

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
