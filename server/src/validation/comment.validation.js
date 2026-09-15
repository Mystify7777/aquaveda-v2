import { z } from "zod";
import { objectIdString } from "./shared/objectId.js";

/**
 * Comment request-shape validation.
 *
 * Zod validates that `refType` is one of the two recognized values and
 * that `refId`/`parentComment` are shaped like ObjectIds. It does NOT
 * validate that `refId` actually points to an existing document of the
 * type named by `refType`, and it does NOT validate the one-level
 * nesting rule (a `parentComment` must itself be a top-level comment) —
 * both require reading other documents and are service-layer
 * responsibilities (persistence-design.md §3).
 */
export const createCommentSchema = z.object({
  refType: z.enum(["ISSUE", "WIKI"]),
  refId: objectIdString,
  body: z.string().trim().min(1, "body is required"),
  parentComment: objectIdString.optional().nullable(),
});

/**
 * Comment thread read query shape (Issue #48).
 *
 * Query params, not path params — matches the locked v1 precedent
 * (`GET /api/v1/comments?refType=ISSUE|WIKI&refId=...`), explicitly
 * cited in Comment.js's own schema comment. No pagination here: threads
 * are read as a whole (grouped into top-level + one level of replies in
 * the service layer, per persistence-design.md §6's own documented
 * plan) — a thread-length cap exists in the service layer as a safety
 * bound, not exposed as a caller-controlled page/limit, since nothing
 * in the current product plan calls for paging within a single thread.
 */
export const commentThreadQuerySchema = z.object({
  refType: z.enum(["ISSUE", "WIKI"]),
  refId: objectIdString,
});
