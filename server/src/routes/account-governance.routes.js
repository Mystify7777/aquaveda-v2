import { Router } from "express";

import {
  muteAccount,
  liftMute,
  suspendAccount,
  liftSuspension,
} from "../services/account-governance.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import { requireActor } from "../services/authorization.js";
import {
  accountIdParamSchema,
  muteAccountSchema,
  liftMuteSchema,
  suspendAccountSchema,
  liftSuspensionSchema,
} from "../validation/account-governance.validation.js";

/**
 * Account-governance routes (#174). Thin routing only: authorization (ADMIN)
 * lives in the service. Mounted at /api/v1/accounts.
 *
 *   POST /:userId/mute        mute an ACTIVE account until expiresAt (ADMIN)
 *   POST /:userId/mute/lift   lift a MUTE early (ADMIN)
 *   POST /:userId/suspend      hard-suspend an ACTIVE account, temporary or
 *                              indefinite (ADMIN)
 *   POST /:userId/suspend/lift lift a HARD_SUSPENDED state early (ADMIN)
 *
 * Authentication precedes validation (anonymous callers get 401, not field
 * detail). Responses are explicit DTOs; raw User documents are never returned.
 */
export const accountGovernanceRouter = Router();

accountGovernanceRouter.use((req, res, next) => {
  try {
    requireActor(req.actorContext);
    next();
  } catch (err) {
    sendError(res, err);
  }
});

accountGovernanceRouter.post("/:userId/mute", async (req, res) => {
  const params = accountIdParamSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, params.error);
  const body = muteAccountSchema.safeParse(req.body ?? {});
  if (!body.success) return sendValidationError(res, body.error);
  try {
    sendSuccess(res, await muteAccount(req.actorContext, params.data.userId, body.data), "Account muted");
  } catch (err) {
    sendError(res, err);
  }
});

accountGovernanceRouter.post("/:userId/mute/lift", async (req, res) => {
  const params = accountIdParamSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, params.error);
  const body = liftMuteSchema.safeParse(req.body ?? {});
  if (!body.success) return sendValidationError(res, body.error);
  try {
    sendSuccess(res, await liftMute(req.actorContext, params.data.userId, body.data), "Mute lifted");
  } catch (err) {
    sendError(res, err);
  }
});

accountGovernanceRouter.post("/:userId/suspend", async (req, res) => {
  const params = accountIdParamSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, params.error);
  const body = suspendAccountSchema.safeParse(req.body ?? {});
  if (!body.success) return sendValidationError(res, body.error);
  try {
    sendSuccess(res, await suspendAccount(req.actorContext, params.data.userId, body.data), "Account suspended");
  } catch (err) {
    sendError(res, err);
  }
});

accountGovernanceRouter.post("/:userId/suspend/lift", async (req, res) => {
  const params = accountIdParamSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, params.error);
  const body = liftSuspensionSchema.safeParse(req.body ?? {});
  if (!body.success) return sendValidationError(res, body.error);
  try {
    sendSuccess(res, await liftSuspension(req.actorContext, params.data.userId, body.data), "Suspension lifted");
  } catch (err) {
    sendError(res, err);
  }
});
