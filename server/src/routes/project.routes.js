import { Router } from "express";

import { createProject, listProjects, getProjectById } from "../services/project.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import { createProjectSchema, listProjectsQuerySchema } from "../validation/project.validation.js";

/**
 * Project routes.
 *
 * Locked contract: docs/architecture/decision-register.md "Locked —
 * Routes" (ROUTE-L1–L6). Exactly 1 route, 1:1 with project.service.js's
 * 1 exported operation (ROUTE-L2). Same conventions as
 * issue.routes.js/knowledge.routes.js/comment.routes.js.
 *
 * UPDATED (Issue #48): 2 public read routes added — GET / (list) and
 * GET /:projectId (detail). See issue.routes.js's identical note on
 * ROUTE-L2's amendment.
 */

export const projectRouter = Router();

/**
 * GET / — public Project list.
 */
projectRouter.get("/", async (req, res) => {
  const parsed = listProjectsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await listProjects(parsed.data);
    sendSuccess(res, result, "Projects retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /:projectId — public Project detail.
 */
projectRouter.get("/:projectId", async (req, res) => {
  try {
    const project = await getProjectById(req.params.projectId);
    sendSuccess(res, project, "Project retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

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
