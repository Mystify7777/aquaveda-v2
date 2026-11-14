import { z } from "zod";

import { paginationQuerySchema } from "./shared/pagination.js";

export const DISCUSSION_CATEGORY_VALUES = [
  "QUESTION",
  "DISCUSSION",
  "IDEA",
];

export const createDiscussionSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  body: z.string().trim().min(1, "body is required"),
  category: z.enum(DISCUSSION_CATEGORY_VALUES),
});

export const listDiscussionsQuerySchema = paginationQuerySchema;
