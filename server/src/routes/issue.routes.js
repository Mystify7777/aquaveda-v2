import { Router } from "express";

import { createIssue, changeStatus } from "../services/issue.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import {
  createIssueSchema,
  changeIssueStatusSchema,
} from "../validation/issue.validation.js";

/**
 * Issue routes.
 *
 * Locked contract: docs/architecture/decision-register.md "Locked —
 * Routes" (ROUTE-L1–L6), derived from
 * routes-milestone-discovery-report.md and
 * routes-implementation-plan.md Phase 3.
 *
 * Exactly 2 routes, 1:1 with issue.service.js's 2 exported operations
 * (ROUTE-L2) — no retrieval/listing, no edit/delete.
 *
 * Kept thin, matching auth.routes.js's own convention: HTTP request →
 * validate → issue.service.js → HTTP response via the shared
 * sendSuccess/sendError utility (ROUTE-L4/L6). No requireActor/
 * requireRole call anywhere in this file (ROUTE-L3) — every operation
 * already enforces its own actor/role requirements; a route-level gate
 * would only duplicate that, not add anything. No JWT verification, no
 * cookie parsing here — req.actorContext is already resolved by the
 * globally-mounted authMiddleware (ROUTE-L1) before this router ever
 * runs.
 */

export const issueRouter = Router();

issueRouter.post("/", async (req, res) => {
  const parsed = createIssueSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const issue = await createIssue(req.actorContext, parsed.data);
    sendSuccess(res, issue, "Issue created", 201);
  } catch (err) {
    sendError(res, err);
  }
});

issueRouter.patch("/:issueId/status", async (req, res) => {
  const parsed = changeIssueStatusSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const issue = await changeStatus(
      req.actorContext,
      req.params.issueId,
      parsed.data.targetStatus,
    );
    sendSuccess(res, issue, "Issue status updated");
  } catch (err) {
    sendError(res, err);
  }
});

export default issueRouter;
