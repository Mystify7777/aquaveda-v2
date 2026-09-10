import { Router } from "express";

import { createProject } from "../services/project.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import { createProjectSchema } from "../validation/project.validation.js";

/**
 * Project routes.
 *
 * Locked contract: docs/architecture/decision-register.md "Locked —
 * Routes" (ROUTE-L1–L6). Exactly 1 route, 1:1 with project.service.js's
 * 1 exported operation (ROUTE-L2). Same conventions as
 * issue.routes.js/knowledge.routes.js/comment.routes.js.
 */

export const projectRouter = Router();

projectRouter.post("/", async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const project = await createProject(req.actorContext, parsed.data);
    sendSuccess(res, project, "Project created", 201);
  } catch (err) {
    sendError(res, err);
  }
});

export default projectRouter;
