import { Router } from "express";

import {
  createDiscussion,
  getPublicDiscussionById,
  listPublicDiscussions,
} from "../services/discussion.service.js";
import { toPublicDiscussionDTO } from "../services/discussion.dto.js";
import {
  sendSuccess,
  sendError,
  sendValidationError,
} from "../http/respond.js";
import {
  createDiscussionSchema,
  listDiscussionsQuerySchema,
} from "../validation/discussion.validation.js";

/**
 * Discussion routes.
 *
 * Routes stay thin: validate request shape -> domain service -> explicit
 * public DTO -> shared response envelope. Authentication/authorization
 * remains a service concern; req.actorContext is produced globally by the
 * advisory auth middleware.
 *
 * Public:
 *   GET /api/v1/discussions
 *   GET /api/v1/discussions/:discussionId
 *
 * Authenticated:
 *   POST /api/v1/discussions
 */
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

export default discussionRouter;
