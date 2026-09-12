import { Router } from "express";

import { listIssues } from "../services/issue.service.js";
import { DomainErrorCode } from "../services/errors.js";
import { paginationSchema } from "../validation/shared/pagination.validation.js";

/**
 * Issues routes — the first domain read endpoint, added as part of
 * Issue #40 (pagination).
 *
 * This router is deliberately narrow: one GET endpoint with pagination
 * query parameters. It does not include create/update/status-change
 * operations — those belong to the future Routes milestone, decided
 * with its own review.
 *
 * Scope discipline (same principles as auth.routes.js):
 * - Thin route: HTTP request → service → HTTP response.
 * - No actor resolution here (authMiddleware already ran globally).
 * - No auth requirement — this is a public read endpoint, per Product
 *   Invariant 5 ("Anonymous users may explore").
 * - Validation is applied only to query parameters (page/limit), through
 *   the shared Zod schema in `pagination.validation.js`.
 */

/**
 * Pagination validation-failure translator, kept local to this router.
 * Response shape matches auth.routes.js's `sendValidationError` exactly
 * (`{ success, code, message }`) for API envelope consistency.
 */
function sendValidationError(res, zodError) {
  res.status(400).json({
    success: false,
    code: DomainErrorCode.VALIDATION_FAILED,
    message: zodError.issues[0]?.message || "Invalid query parameters",
  });
}

export const issuesRouter = Router();

/**
 * GET /api/v1/issues
 *
 * Lists issues with offset-based pagination.
 *
 * Query parameters:
 *   page  — 1-indexed page number (default: 1)
 *   limit — items per page (default: 10, max: 50)
 *
 * Response envelope:
 *   { success: true, data: [...], pagination: { page, limit, totalCount, totalPages, hasNextPage, hasPrevPage } }
 */
issuesRouter.get("/", async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await listIssues(parsed.data);
    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    // Unexpected errors — listIssues has no known domain-error throw
    // paths (it's a simple read), but defensive handling for any
    // infrastructure-level failure (e.g. MongoDB connectivity).
    console.error("[issues.routes] Unexpected error:", err);
    res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  }
});

export default issuesRouter;
