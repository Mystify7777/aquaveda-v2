import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Knowledge.reviewHistory entry
 *
 * Embedded subdocument, per ADR-0005. Records one review *decision*
 * only (approve or reject) — deliberately does NOT contain a synthetic
 * entry for `draft` creation or `pending_review` submission (ADR-0005 §2,
 * an intentional asymmetry with Issue.statusHistory).
 *
 * Schema-enforceable here:
 * - `decision` enum membership
 * - required fields
 * - `feedback` required when `decision === "rejected"` — this is a
 *   same-subdocument conditional check (no cross-document read needed),
 *   so unlike the cross-document invariants below it genuinely can be
 *   expressed as a Mongoose validator. Added as defense-in-depth
 *   alongside Zod's primary enforcement at the API boundary, consistent
 *   with persistence-design.md §7's "cheap, structural duplication is
 *   acceptable" principle. Flagged in the Phase B report as a judgment
 *   call, since no approved document explicitly assigned this specific
 *   check to Mongoose.
 *
 * NOT enforced here (service layer, ADR-0004):
 * - `reviewerId !== authorId` (requires reading the parent Knowledge
 *   document's `author` field — cross-document/contextual, not
 *   expressible as a static subdocument rule)
 * - whether `pending_review -> decision` is a legal transition at all
 *   (e.g. rejecting a `draft` directly)
 * - reviewer authority (must be an authorized Expert — ADR-0004)
 */
const reviewHistoryEntrySchema = new Schema(
  {
    decision: {
      type: String,
      enum: ["approved", "rejected"],
      required: true,
    },
    reviewer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    feedback: {
      type: String,
      validate: {
        validator: function (value) {
          if (this.decision === "rejected") {
            return typeof value === "string" && value.trim().length > 0;
          }
          return true;
        },
        message:
          "feedback is required and must be non-empty when decision is 'rejected'",
      },
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { _id: true },
);

/**
 * Knowledge
 *
 * Schema-enforceable constraints (this file):
 * - required fields, type correctness
 * - `status` enum membership
 * - `author` required + immutable (best-effort, see note below)
 *
 * NOT enforced here (service layer, ADR-0004):
 * - legality of a status transition (draft -> pending_review ->
 *   approved/rejected -> draft; no other edges)
 * - `reviewerId !== authorId`
 * - review authority (EXPERT only, per ADR-0004 — this schema does not
 *   know what an Expert is)
 * - content immutability during `pending_review` (a write-path rule, not
 *   a document-shape rule)
 *
 * No `reviewer` top-level field exists on this schema — reviewer identity
 * belongs only inside `reviewHistory` entries (ADR-0005 §3), since a
 * single flat field would only ever hold the most recent reviewer and
 * would misrepresent an article that has been reviewed more than once.
 */
const KNOWLEDGE_STATUSES = ["draft", "pending_review", "approved", "rejected"];

const knowledgeSchema = new Schema(
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
    region: {
      type: String,
      default: "",
    },
    regionKey: {
      type: String,
      default: "",
    },
    // Optional at the persistence layer until Issue #230 backfills legacy records.
    // Issue #231 enforces one ACTIVE canonical Category on normal authoring paths.
    category: {
      type: String,
      trim: true,
    },
    topics: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: KNOWLEDGE_STATUSES,
      required: true,
      default: "draft",
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true, // defense-in-depth only; see Issue.js for the same note
    },
    reviewHistory: {
      type: [reviewHistoryEntrySchema],
      default: [],
    },
  },
  { timestamps: true },
);

// Approved indexes only (persistence-design.md §6 / ADR-0005):
knowledgeSchema.index({ status: 1 });
knowledgeSchema.index({ author: 1 });

export const Knowledge = mongoose.model("Knowledge", knowledgeSchema);
export default Knowledge;
