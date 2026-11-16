import { z } from "zod";

import { paginationQuerySchema } from "./shared/pagination.js";

export const DISCUSSION_CATEGORY_VALUES = [
  "QUESTION",
  "DISCUSSION",
  "IDEA",
];

export const DISCUSSION_REPORT_REASON_VALUES = [
  "SPAM",
  "HARASSMENT",
  "MISLEADING",
  "INAPPROPRIATE",
  "OTHER",
];

export const createDiscussionSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  body: z.string().trim().min(1, "body is required"),
  category: z.enum(DISCUSSION_CATEGORY_VALUES),
});

export const listDiscussionsQuerySchema = paginationQuerySchema;

export const reportDiscussionSchema = z.object({
  reason: z.enum(DISCUSSION_REPORT_REASON_VALUES),
});

export const hideDiscussionSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const unhideDiscussionSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const listDiscussionReportsQuerySchema = paginationQuerySchema;
