import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Comment
 *
 * Attaches to an Issue, Knowledge article, or independent Discussion via the `refType`
 * discriminator — a shared primitive, not a per-target collection.
 *
 * Schema-enforceable constraints (this file):
 * - required fields, type correctness
 * - `refType` enum membership
 * - compound index on (refType, refId) for the one established access
 *   pattern (listing a target's comments)
 *
 * NOT enforced here (service layer, per persistence-design.md §3 and §6):
 * - one-level nesting: "a `parentComment` may reference only a top-level
 *   Comment; a Comment whose own `parentComment` is non-null cannot be
 *   used as a parent." This requires loading the referenced parent
 *   Comment and inspecting its own `parentComment` field at write time —
 *   a cross-document, contextual check, not something Mongoose can
 *   validate from this document's own fields. No recursive/depth
 *   validator is implemented here; deliberately left to the service
 *   layer's `createComment`/`replyToComment` operation.
 * - that `refId` actually points to an existing Issue, Knowledge, or Discussion
 *   document of the type named by `refType` (refId is intentionally
 *   untyped/polymorphic — no `ref` option is set, since it can't point
 *   to one fixed collection)
 *
 * No `parentComment` index is created — no established access pattern
 * queries by parentComment directly (see persistence-design.md §6); all
 * currently planned reads go through the (refType, refId) index and
 * group replies in the response layer.
 */
const commentSchema = new Schema(
  {
    refType: {
      type: String,
      enum: ["ISSUE", "WIKI", "DISCUSSION"],
      // "WIKI" (not "KNOWLEDGE") is the correct value here — verified
      // against persistence-design.md §3/§10 and v1's proven API shape
      // (`GET /api/v1/comments?refType=ISSUE|WIKI&refId=...`), both of
      // which lock this exact discriminator value. The Knowledge
      // collection's target-type name intentionally stays "WIKI" in this
      // field even though the collection itself is named `Knowledge` —
      // this is the locked terminology, not a naming inconsistency to
      // silently "fix."
      required: true,
    },
    refId: {
      type: Schema.Types.ObjectId,
      required: true,
      // No `ref` set — polymorphic by design (refType determines which
      // collection refId actually points to).
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    parentComment: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },
  },
  { timestamps: true },
);

// Approved index only:
commentSchema.index({ refType: 1, refId: 1 });

export const Comment = mongoose.model("Comment", commentSchema);
export default Comment;
