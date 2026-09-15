import { z } from "zod";
import { objectIdString } from "./shared/objectId.js";
import { paginationQuerySchema } from "./shared/pagination.js";

/**
 * Project request-shape validation.
 *
 * Zod validates that `originIssue` is shaped like an ObjectId. It does
 * NOT validate that the referenced Issue exists, or that its current
 * status is in the allowed creation set
 * ({acknowledged, in_progress, resolved, verified}) — that requires
 * reading the Issue document's current state and is explicitly a
 * service-layer responsibility (`createProject()`, per
 * persistence-design.md §7 and the implementation plan §19).
 */
export const createProjectSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  description: z.string().trim().min(1, "description is required"),
  originIssue: objectIdString,
});

/**
 * Public Project list query shape (Issue #48).
 *
 * `originIssue` filtering is optional — a real, indexed access pattern
 * (an Issue detail page showing its related Projects), unlike a
 * hypothetical status filter (Project has no status field at all,
 * per Project.js's own header comment).
 */
export const listProjectsQuerySchema = paginationQuerySchema.extend({
  originIssue: objectIdString.optional(),
});
