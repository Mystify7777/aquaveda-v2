import mongoose from "mongoose";

import {
  DISCUSSION_CATEGORIES,
  DISCUSSION_STATUSES,
} from "../domain/discussion.js";
import { DISCUSSION_MODERATION_ACTIONS } from "../domain/discussion-moderation.js";

const { Schema } = mongoose;

/**
 * Append-only Discussion moderation history entry.
 *
 * The entry is pushed in the same atomic status transition that changes
 * Discussion.status, so the current visibility state and its audit trail
 * cannot diverge through a partial write.
 */
const moderationHistoryEntrySchema = new Schema(
  {
    actor: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    action: {
      type: String,
      enum: DISCUSSION_MODERATION_ACTIONS,
      required: true,
      immutable: true,
    },
    fromStatus: {
      type: String,
      enum: DISCUSSION_STATUSES,
      required: true,
      immutable: true,
    },
    toStatus: {
      type: String,
      enum: DISCUSSION_STATUSES,
      required: true,
      immutable: true,
    },
    reason: {
      type: String,
      default: null,
      immutable: true,
      maxlength: 500,
    },
    timestamp: {
      type: Date,
      required: true,
      immutable: true,
    },
  },
  { _id: true },
);

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
 * - append-only moderation history entry shape
 *
 * Visibility transitions and moderation authority remain service/domain
 * responsibilities.
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
    moderationHistory: {
      type: [moderationHistoryEntrySchema],
      default: [],
    },
  },
  { timestamps: true },
);

// ADR-0009: supports the public ACTIVE-only list ordered by creation time
// with MongoDB ObjectId as the deterministic tie-breaker.
discussionSchema.index({ status: 1, createdAt: -1, _id: -1 });

export const Discussion = mongoose.model("Discussion", discussionSchema);
export default Discussion;
