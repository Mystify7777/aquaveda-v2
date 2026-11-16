import mongoose from "mongoose";

import { DISCUSSION_REPORT_REASONS } from "../domain/discussion-moderation.js";

const { Schema } = mongoose;

/**
 * DiscussionReport
 *
 * Immutable report submission. Reports are deliberately separate from
 * Discussion content and are never included in public projections.
 *
 * Duplicate prevention is a database invariant: one report per authenticated
 * reporter per Discussion.
 */
const discussionReportSchema = new Schema(
  {
    discussion: {
      type: Schema.Types.ObjectId,
      ref: "Discussion",
      required: true,
      immutable: true,
    },
    reporter: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    reason: {
      type: String,
      enum: DISCUSSION_REPORT_REASONS,
      required: true,
      immutable: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

discussionReportSchema.index(
  { discussion: 1, reporter: 1 },
  { unique: true },
);
discussionReportSchema.index({ createdAt: -1, _id: -1 });

export const DiscussionReport = mongoose.model(
  "DiscussionReport",
  discussionReportSchema,
);
export default DiscussionReport;
