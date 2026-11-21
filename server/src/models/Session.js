import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Session
 *
 * Refresh-token/session persistence for Authentication, per
 * docs/architecture/decision-register.md's "Locked — Authentication"
 * section (L8, L9, L12, L13, L15) and
 * docs/architecture/authentication-implementation-plan.md Phase B.
 *
 * Deliberately a dedicated collection, not a field embedded on `User`
 * (L8): identity/profile data (User) and time-bounded session-lifecycle
 * data (Session) have different responsibilities, lifecycles, retention
 * rules, and invalidation semantics — independent of refresh-rotation
 * strategy or write frequency. Named `Session`, not `RefreshToken` (L9),
 * since it represents a session's lifecycle, which may eventually carry
 * more than a token hash.
 *
 * This document's own `_id` IS the `sid` referenced in the refresh JWT
 * payload (L15/L16) — no separate `sid` field exists.
 *
 * Schema-enforceable constraints (this file):
 * - required fields, type correctness
 * - `userId` reference (indexed)
 * - `tokenHash` excluded from default query projection
 *   (`select: false`), matching `User.passwordHash`'s existing pattern
 * - `expiresAt` required, backed by a real MongoDB TTL index for
 *   eventual physical cleanup
 *
 * NOT enforced here (service layer — Phase C, not yet implemented in
 * this phase):
 * - refresh-token rotation / single-use consumption (L14, L14a) — this
 *   phase adds persistence only, no rotation logic
 * - the independent `expiresAt > now` check services must perform
 *   before treating a session as valid (see the TTL note below) — that
 *   check lives in the future auth service, not in this schema
 * - hashing itself (SHA-256 of the raw refresh token, per the
 *   implementation plan's Phase A) — this schema only declares that
 *   `tokenHash` is a required string; it does not hash anything
 *
 * TTL cleanup is NOT authorization/security enforcement. MongoDB's TTL
 * background monitor runs periodically (not instantaneously), so a
 * Session document can be logically expired but still physically
 * present for some window after `expiresAt` has passed. Any future code
 * that reads a Session to decide whether a refresh is valid MUST
 * independently check `expiresAt > now` and treat an expired-but-not-
 * yet-swept document as invalid — this schema's TTL index only
 * guarantees eventual deletion, never real-time invalidation.
 */

const sessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
      select: false, // excluded from query results unless explicitly
      // requested — matches User.passwordHash's existing defensive
      // pattern. Does not prevent filtering ON this field in a query
      // (e.g. a future findOneAndDelete({ tokenHash: ... })); it only
      // excludes the field from what's returned in result documents.
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    // The user's credential generation (User.authGeneration) at issuance
    // (#217/#219). Absent means 0, so existing Session records and users need
    // no migration, and it is stored only when non-zero. refresh() accepts a
    // session only if this equals the user's CURRENT generation, so a session
    // issued before a suspension is restored is unusable the moment the
    // restoring write commits, independent of any cleanup. Cleanup is bound to
    // a generation and can therefore never match a later session.
    authGeneration: {
      type: Number,
      min: 0,
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

// Approved indexes (authentication-implementation-plan.md Phase B):

// Supports resolving/invalidating a user's session(s) by user reference.
// No current operation in this phase uses this beyond the reference
// itself, but it's the natural companion index to a required, referenced
// `userId` field, same as every other ref field in this project.
sessionSchema.index({ userId: 1 });

// Real MongoDB TTL index, not an ordinary index: `expireAfterSeconds: 0`
// means "delete at the time stored in `expiresAt` itself" (appropriate
// here since `expiresAt` is already an absolute timestamp, not a
// relative duration). This is the eventual-cleanup mechanism only — see
// the TTL note in the header comment above. It is not, and must never be
// treated as, the runtime expiry check.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model("Session", sessionSchema);
export default Session;
