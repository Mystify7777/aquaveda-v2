import { Router } from "express";

import {
  applyForExpert,
  getMyExpertApplication,
  listPendingExpertApplications,
  approveExpertApplication,
  rejectExpertApplication,
} from "../services/expert-application.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import { createRateLimiter } from "../middleware/rate-limiter.js";
import { requireActor } from "../services/authorization.js";
import {
  applicantIdParamSchema,
  applyExpertApplicationSchema,
  approveExpertApplicationSchema,
  rejectExpertApplicationSchema,
  pendingExpertApplicationsQuerySchema,
} from "../validation/expert-application.validation.js";

/**
 * Expert-application routes (#91). Thin routing only — authorization
 * lives in the service (requireActor / requireRole), as for every other
 * router. Mounted at /api/v1/expert-application.
 *
 *   POST /                    apply (USER), body = submission; IP rate-limited
 *                             (existing limiter; per-instance, in-memory)
 *   GET  /me                  own application status (any authenticated actor)
 *   GET  /                    pending queue (ADMIN)
 *   POST /:userId/approve     pending -> approved, grants EXPERT (ADMIN); { revision, note? }
 *   POST /:userId/reject      pending -> rejected (ADMIN); { revision, note }
 *
 * `revision` is the history length of the application the reviewer saw. A stale
 * decision is 409: STATE_RACE when the application is still pending but its
 * revision differs (or the atomic write matches nothing); INVALID_STATE when the
 * application is no longer pending at all (another decision already landed).
 * Bodies are strict. The route hands its normalized `parsed.data` to the service,
 * which validates again so direct callers cannot bypass the contract.
 */
const applyLimiter = createRateLimiter({
  windowMs: 3_600_000,
  maxRequests: 10,
  keyPrefix: "expert:apply:",
});

export const expertApplicationRouter = Router();

// Authentication precedes ALL request validation. Bodies are required and strict,
// so without this an anonymous caller with a missing or invalid body would get a
// 400 (and field-level validation detail) instead of 401. It also keeps anonymous
// traffic out of the apply rate limiter. Uses the service's own rule and message.
expertApplicationRouter.use((req, res, next) => {
  try {
    requireActor(req.actorContext);
    next();
  } catch (err) {
    sendError(res, err);
  }
});

expertApplicationRouter.post("/", applyLimiter, async (req, res) => {
  const parsed = applyExpertApplicationSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  try {
    sendSuccess(res, await applyForExpert(req.actorContext, parsed.data), "Expert application submitted", 201);
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
  const body = approveExpertApplicationSchema.safeParse(req.body ?? {});
  if (!body.success) return sendValidationError(res, body.error);
  try {
    sendSuccess(
      res,
      await approveExpertApplication(req.actorContext, params.data.userId, body.data),
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
      await rejectExpertApplication(req.actorContext, params.data.userId, body.data),
      "Expert application rejected",
    );
  } catch (err) {
    sendError(res, err);
  }
});
