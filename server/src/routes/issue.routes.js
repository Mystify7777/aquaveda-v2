import { Router } from "express";

import { createIssue, changeStatus, listIssues } from "../services/issue.service.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";
import {
  createIssueSchema,
  changeIssueStatusSchema,
} from "../validation/issue.validation.js";
import { paginationSchema } from "../validation/shared/pagination.validation.js";

/**
 * Issue routes.
 *
 * Locked contract: docs/architecture/decision-register.md "Locked —
 * Routes" (ROUTE-L1–L6), derived from
 * routes-milestone-discovery-report.md and
 * routes-implementation-plan.md Phase 3.
 *
 * Includes public issue listing with pagination (Issue #40), issue
 * creation, and issue status transition operations.
 *
 * Kept thin, matching auth.routes.js's own convention: HTTP request →
 * validate → issue.service.js → HTTP response via the shared
 * sendSuccess/sendError utility (ROUTE-L4/L6).
 */

export const issueRouter = Router();

issueRouter.get("/", async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await listIssues(parsed.data);
    sendSuccess(res, result.data, "Issues retrieved successfully", 200, {
      pagination: result.pagination,
    });
  } catch (err) {
    sendError(res, err);
  }
});

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
