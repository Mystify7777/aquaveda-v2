import { Router } from "express";

import {
  createDiscussion,
  getPublicDiscussionById,
  listPublicDiscussions,
} from "../services/discussion.service.js";
import {
  hideDiscussion,
  reportDiscussion,
  unhideDiscussion,
} from "../services/discussion-moderation.service.js";
import { toPublicDiscussionDTO } from "../services/discussion.dto.js";
import {
  sendSuccess,
  sendError,
  sendValidationError,
} from "../http/respond.js";
import { createRateLimiter } from "../middleware/rate-limiter.js";
import { requireActor } from "../services/authorization.js";
import {
  createDiscussionSchema,
  hideDiscussionSchema,
  listDiscussionsQuerySchema,
  reportDiscussionSchema,
  unhideDiscussionSchema,
} from "../validation/discussion.validation.js";

/**
 * Discussion routes.
 *
 * Public:
 *   GET /api/v1/discussions
 *   GET /api/v1/discussions/:discussionId
 *
 * Authenticated:
 *   POST /api/v1/discussions
 *   POST /api/v1/discussions/:discussionId/reports
 *   POST /api/v1/discussions/:discussionId/hide
 *   POST /api/v1/discussions/:discussionId/unhide (ADMIN)
 *
 * Moderation/reporting authority remains in the service layer. The router
 * only performs request-shape validation and applies the report endpoint's
 * abuse limiter.
 */

const reportLimiter = createRateLimiter({
  windowMs: 3_600_000,
  maxRequests: 10,
  keyPrefix: "discussion:report:",
});

function requireAuthenticated(req, res, next) {
  try {
    requireActor(req.actorContext);
    next();
  } catch (err) {
    sendError(res, err);
  }
}

export const discussionRouter = Router();

discussionRouter.get("/", async (req, res) => {
  const parsed = listDiscussionsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await listPublicDiscussions(parsed.data);
    sendSuccess(
      res,
      {
        ...result,
        items: result.items.map(toPublicDiscussionDTO),
      },
      "Discussions retrieved",
    );
  } catch (err) {
    sendError(res, err);
  }
});

discussionRouter.get("/:discussionId", async (req, res) => {
  try {
    const discussion = await getPublicDiscussionById(req.params.discussionId);
    sendSuccess(
      res,
      toPublicDiscussionDTO(discussion),
      "Discussion retrieved",
    );
  } catch (err) {
    sendError(res, err);
  }
});

discussionRouter.post("/", async (req, res) => {
  const parsed = createDiscussionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const discussion = await createDiscussion(
      req.actorContext,
      parsed.data,
    );
    sendSuccess(
      res,
      toPublicDiscussionDTO(discussion),
      "Discussion created",
      201,
    );
  } catch (err) {
    sendError(res, err);
  }
});

discussionRouter.post("/:discussionId/reports", requireAuthenticated, reportLimiter, async (req, res) => {
  try {
    const parsed = reportDiscussionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const report = await reportDiscussion(
      req.actorContext,
      req.params.discussionId,
      parsed.data.reason,
    );

    sendSuccess(
      res,
      {
        submitted: true,
        reason: report.reason,
        createdAt: report.createdAt,
      },
      "Discussion report submitted",
      201,
    );
  } catch (err) {
    sendError(res, err);
  }
});

discussionRouter.post("/:discussionId/hide", async (req, res) => {
  try {
    requireActor(req.actorContext);

    const parsed = hideDiscussionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const discussion = await hideDiscussion(
      req.actorContext,
      req.params.discussionId,
      parsed.data.reason,
    );

    sendSuccess(
      res,
      toPublicDiscussionDTO(discussion),
      "Discussion hidden",
    );
  } catch (err) {
    sendError(res, err);
  }
});

discussionRouter.post("/:discussionId/unhide", async (req, res) => {
  try {
    requireActor(req.actorContext);

    const parsed = unhideDiscussionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const discussion = await unhideDiscussion(
      req.actorContext,
      req.params.discussionId,
      parsed.data.reason,
    );

    sendSuccess(
      res,
      toPublicDiscussionDTO(discussion),
      "Discussion restored",
    );
  } catch (err) {
    sendError(res, err);
  }
});

export default discussionRouter;
