import mongoose from "mongoose";

import {
  DISCUSSION_CATEGORIES,
  DISCUSSION_STATUSES,
} from "../domain/discussion.js";

const { Schema } = mongoose;

/**
 * Discussion
 *
 * First-class, independently addressable Community conversation.
 *
 * Schema owns structural constraints:
 * - required fields and types
 * - category/status enum membership
 * - immutable author
 * - public list ordering index
 *
 * Visibility transitions and moderation authority remain service/domain
 * responsibilities. #167 owns the concrete hide/unhide/reporting contract.
 */
const discussionSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: DISCUSSION_CATEGORIES,
      required: true,
    },
    status: {
      type: String,
      enum: DISCUSSION_STATUSES,
      required: true,
      default: "ACTIVE",
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
  },
  { timestamps: true },
);

// ADR-0009: supports the public ACTIVE-only list ordered by creation time
// with MongoDB ObjectId as the deterministic tie-breaker.
discussionSchema.index({ status: 1, createdAt: -1, _id: -1 });

export const Discussion = mongoose.model("Discussion", discussionSchema);
export default Discussion;
