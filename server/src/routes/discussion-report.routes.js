import { Router } from "express";

import { sendError, sendSuccess, sendValidationError } from "../http/respond.js";
import { requireActor } from "../services/authorization.js";
import { listDiscussionReports } from "../services/discussion-moderation.service.js";
import { listDiscussionReportsQuerySchema } from "../validation/discussion.validation.js";

/**
 * Minimal private report-review read surface.
 *
 * This is intentionally not a moderation dashboard. It gives ADMIN the
 * server-authoritative report evidence needed to review submissions while
 * leaving moderation decisions on the Discussion visibility endpoints.
 */
export const discussionReportRouter = Router();

discussionReportRouter.get("/", async (req, res) => {
  try {
    requireActor(req.actorContext);

    const parsed = listDiscussionReportsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const result = await listDiscussionReports(
      req.actorContext,
      parsed.data,
    );
    sendSuccess(res, result, "Discussion reports retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

export default discussionReportRouter;
