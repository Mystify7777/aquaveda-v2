import { Router } from "express";

import { listCommunityActivity } from "../services/community-activity.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import { communityActivityQuerySchema } from "../validation/community.validation.js";

export const communityRouter = Router();

/**
 * GET /api/v1/community/activity
 *
 * Public, read-only derived projection. The service owns source visibility,
 * aggregation, ordering, pagination, and DTO shaping.
 */
communityRouter.get("/activity", async (req, res) => {
  const parsed = communityActivityQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    sendSuccess(
      res,
      await listCommunityActivity(parsed.data),
      "Community activity retrieved",
    );
  } catch (err) {
    sendError(res, err);
  }
});

export default communityRouter;
