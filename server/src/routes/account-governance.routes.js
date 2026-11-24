import { Router } from "express";

import {
  muteAccount,
  liftMute,
  suspendAccount,
  liftSuspension,
} from "../services/account-governance.service.js";
import {
  listAccountDirectory,
  getAccountDirectoryEntry,
  listAccountGovernanceHistory,
} from "../services/account-directory.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import { requireActor, requireRole } from "../services/authorization.js";
import {
  accountIdParamSchema,
  muteAccountSchema,
  liftMuteSchema,
  suspendAccountSchema,
  liftSuspensionSchema,
  accountDirectoryQuerySchema,
  accountHistoryQuerySchema,
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
 *   GET  /                     Admin directory, paginated (ADMIN, read-only, #181)
 *   GET  /:userId              one directory entry (ADMIN)
 *   GET  /:userId/history      governance history of an account (ADMIN)
 *
 * The four POST operations reject a self or Admin target with 403 FORBIDDEN and
 * reason SELF_TARGET_PROHIBITED / ADMIN_TARGET_PROTECTED (ADR-0012, #255); the
 * check lives in the service, not here.
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

// --- Admin directory (#181): read-only -------------------------------------
// ADMIN is checked BEFORE query/param validation so a non-ADMIN never receives
// field-level validation detail (403, not 400). The service enforces it again.
const adminOnly = (req, res, next) => {
  try {
    requireRole(req.actorContext, "ADMIN");
    next();
  } catch (err) {
    sendError(res, err);
  }
};

accountGovernanceRouter.get("/", adminOnly, async (req, res) => {
  const query = accountDirectoryQuerySchema.safeParse(req.query ?? {});
  if (!query.success) return sendValidationError(res, query.error);
  try {
    sendSuccess(res, await listAccountDirectory(req.actorContext, query.data), "Accounts retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

accountGovernanceRouter.get("/:userId", adminOnly, async (req, res) => {
  const params = accountIdParamSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, params.error);
  try {
    sendSuccess(res, await getAccountDirectoryEntry(req.actorContext, params.data.userId), "Account retrieved");
  } catch (err) {
    sendError(res, err);
  }
});

accountGovernanceRouter.get("/:userId/history", adminOnly, async (req, res) => {
  const params = accountIdParamSchema.safeParse(req.params);
  if (!params.success) return sendValidationError(res, params.error);
  const query = accountHistoryQuerySchema.safeParse(req.query ?? {});
  if (!query.success) return sendValidationError(res, query.error);
  try {
    sendSuccess(
      res,
      await listAccountGovernanceHistory(req.actorContext, params.data.userId, query.data),
      "Governance history retrieved",
    );
  } catch (err) {
    sendError(res, err);
  }
});
