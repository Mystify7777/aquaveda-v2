import { Router } from "express";

import {
  applyForExpert,
  getMyExpertApplication,
  listPendingExpertApplications,
  approveExpertApplication,
  rejectExpertApplication,
} from "../services/expert-application.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import {
  applicantIdParamSchema,
  applyExpertApplicationSchema,
  rejectExpertApplicationSchema,
  pendingExpertApplicationsQuerySchema,
} from "../validation/expert-application.validation.js";

/**
 * Expert-application routes (#91). Thin routing only — authorization
 * lives in the service (requireActor / requireRole), as for every other
 * router. Mounted at /api/v1/expert-application.
 *
 *   POST /                    apply (USER)
 *   GET  /me                  own application status (any authenticated actor)
 *   GET  /                    pending queue (ADMIN)
 *   POST /:userId/approve     pending -> approved, grants EXPERT (ADMIN)
 *   POST /:userId/reject      pending -> rejected (ADMIN)
 */
export const expertApplicationRouter = Router();

expertApplicationRouter.post("/", async (req, res) => {
  const parsed = applyExpertApplicationSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  try {
    sendSuccess(res, await applyForExpert(req.actorContext), "Expert application submitted", 201);
  } catch (err) {
    sendError(res, err);
  }
});

// Registered before /:userId routes; no arbitrary-user variant exists.
expertApplicationRouter.get("/me", async (req, res) => {
  try {
    sendSuccess(res, await getMyExpertApplication(req.actorContext), "Expert application retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

expertApplicationRouter.get("/", async (req, res) => {
  const parsed = pendingExpertApplicationsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  try {
    sendSuccess(
      res,
      await listPendingExpertApplications(req.actorContext, parsed.data),
      "Pending expert applications retrieved",
    );
  } catch (err) {
    sendError(res, err);
  }
});

expertApplicationRouter.post("/:userId/approve", async (req, res) => {
  const params = applicantIdParamSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, params.error);
  try {
    sendSuccess(
      res,
      await approveExpertApplication(req.actorContext, params.data.userId),
      "Expert application approved",
    );
  } catch (err) {
    sendError(res, err);
  }
});

expertApplicationRouter.post("/:userId/reject", async (req, res) => {
  const params = applicantIdParamSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, params.error);
  const body = rejectExpertApplicationSchema.safeParse(req.body ?? {});
  if (!body.success) return sendValidationError(res, body.error);
  try {
    sendSuccess(
      res,
      await rejectExpertApplication(req.actorContext, params.data.userId, body.data.note),
      "Expert application rejected",
    );
  } catch (err) {
    sendError(res, err);
  }
});
