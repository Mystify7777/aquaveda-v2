import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * User
 *
 * Identity and role anchor for every other collection. This milestone
 * persists the shape only — registration, login, password hashing, and
 * role-assignment mechanisms belong to the Authentication/Governance
 * milestone (out of scope here; see docs/architecture/decision-register.md D-2).
 *
 * Schema-enforceable constraints (this file):
 * - required fields, type correctness
 * - `email` uniqueness (via index)
 * - `role` enum membership
 * - `bio` max length
 * - `passwordHash` excluded from default query projection and from JSON
 *   serialization
 *
 * NOT enforced here (service-layer / Authentication milestone):
 * - how a password is hashed, verified, or rotated
 * - how a user is granted ADMIN (#89). EXPERT is granted only through
 *   an approved `expertApplication` (#91, expert-application.service.js)
 * - account suspension/deactivation (decision-register D-1, deferred —
 *   deliberately no `status`/`isActive` field exists on this schema)
 */

const BIO_MAX_LENGTH = 500; // No approved document specifies this number.
// A V2-level implementation placeholder only — not a locked domain
// decision. Reasonable to keep for now (prevents unbounded free text),
// but should not be treated as authoritative; revisit if any future
// milestone needs a different bound.

/**
 * User.expertApplication (#91)
 *
 * Embedded on User (not a new collection) so that approval can flip
 * `role` and `expertApplication.status` in ONE conditional atomic
 * write — the two can never diverge and no transaction is needed
 * (ADR-0005/0006). Absence of the subdocument = never applied.
 *
 * Lifecycle (enforced in expert-application.service.js, not here):
 *   none -> pending, pending -> approved | rejected, rejected -> pending.
 *   `approved` is terminal.
 *
 * `history` is append-only and holds EVERY transition including the
 * initial `null -> pending`. Actor identity lives only in history
 * entries — no flat reviewer/verifiedBy field (ADR-0005 §3).
 */
const EXPERT_APPLICATION_STATUSES = ["pending", "approved", "rejected"];
const EXPERT_NOTE_MAX_LENGTH = 500;

const expertApplicationHistoryEntrySchema = new Schema(
  {
    fromStatus: {
      type: String,
      enum: [null, ...EXPERT_APPLICATION_STATUSES],
      default: null,
    },
    toStatus: {
      type: String,
      enum: EXPERT_APPLICATION_STATUSES,
      required: true,
    },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, trim: true, maxlength: EXPERT_NOTE_MAX_LENGTH },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const expertApplicationSchema = new Schema(
  {
    status: {
      type: String,
      enum: EXPERT_APPLICATION_STATUSES,
      required: true,
    },
    history: { type: [expertApplicationHistoryEntrySchema], default: [] },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true, // creates the approved unique index
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // excluded from query results unless explicitly requested
    },
    role: {
      type: String,
      enum: ["USER", "EXPERT", "ADMIN"],
      required: true,
      default: "USER",
    },
    bio: {
      type: String,
      maxlength: BIO_MAX_LENGTH,
      default: "",
    },
    expertApplication: {
      type: expertApplicationSchema,
      default: undefined, // absent === never applied
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        // Defense-in-depth alongside `select: false` — belt-and-suspenders
        // against passwordHash ever reaching a serialized response, even
        // if a future query explicitly re-selects it.
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

// Reviewer queue (#91): partial index over pending applications only.
userSchema.index(
  { "expertApplication.status": 1, updatedAt: 1 },
  { partialFilterExpression: { "expertApplication.status": "pending" } },
);

// Approved index: unique email (uniqueness comes from `unique: true` above;
// no separate index() call needed for this one).

export const User = mongoose.model("User", userSchema);
export default User;
