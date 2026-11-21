import mongoose from "mongoose";
import {
  AFFILIATION_MAX_LENGTH,
  EXPERIENCE_MAX_LENGTH,
  EXPERTISE_VALUES,
  REFERENCE_MAX_LENGTH,
} from "../domain/expert-application-submission.js";
import { ACCOUNT_STATES } from "../domain/account-state.js";
import {
  RESTRICTION_KINDS,
  SAFE_REASON_MAX_LENGTH,
  validateAccountRecord,
} from "../domain/account-restriction.js";

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
 * - `accountState` lifecycle enum, defaulting to ACTIVE
 * - `accountRestriction` / `accountStateChangedAt`: current restriction
 *   metadata and the valid (state, restriction) combinations
 *   (`domain/account-restriction.js`). Governance HISTORY is not stored here
 * - `bio` max length
 * - `passwordHash` excluded from default query projection and from JSON
 *   serialization
 *
 * NOT enforced here (service-layer / Authentication milestone):
 * - how a password is hashed, verified, or rotated
 * - how a user is granted ADMIN (#89). EXPERT is granted only through
 *   an approved `expertApplication` (#91, expert-application.service.js)
 * - governance mutation semantics and audit history, which belong to the
 *   focused follow-up issues after #168
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

/**
 * Application submission (EXP-L9+, design doc). Embedded on the `-> pending`
 * history entry only, so each attempt keeps what was actually submitted.
 * Deliberately NOT `required` anywhere: legacy entries have none, and the
 * apply service (via validateSubmission) guarantees it for every new write.
 * `acknowledgement.textSha256` is computed server-side from the retained
 * immutable text for `version`; the client only ever supplies `version`.
 */
const expertSubmissionSchema = new Schema(
  {
    expertiseAreas: { type: [{ type: String, enum: EXPERTISE_VALUES }], default: [] },
    experience: { type: String, maxlength: EXPERIENCE_MAX_LENGTH },
    affiliation: { type: String, maxlength: AFFILIATION_MAX_LENGTH },
    references: { type: [{ type: String, maxlength: REFERENCE_MAX_LENGTH }], default: [] },
    acknowledgement: {
      type: new Schema(
        {
          version: { type: Number, required: true },
          textSha256: { type: String, required: true },
          acceptedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
    },
  },
  { _id: false },
);

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
    submission: { type: expertSubmissionSchema, default: undefined },
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

// Current restriction only (MUTED / HARD_SUSPENDED). History is #172.
const accountRestrictionSchema = new Schema(
  {
    kind: {
      type: String,
      enum: Object.values(RESTRICTION_KINDS),
      required: true,
    },
    // TEMPORARY: required. INDEFINITE: must be absent. Never `null` ==
    // "indefinite": indefinite is the explicit `kind`, so a missing expiry on a
    // TEMPORARY restriction is rejected instead of silently never expiring.
    expiresAt: { type: Date, default: undefined },
    // The user-visible reason only. Private moderation notes never live here.
    safeReason: { type: String, trim: true, maxlength: SAFE_REASON_MAX_LENGTH },
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
    accountState: {
      type: String,
      enum: Object.values(ACCOUNT_STATES),
      required: true,
      default: ACCOUNT_STATES.ACTIVE,
    },
    accountStateVersion: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    // When the CURRENT accountState was entered. Absent on ACTIVE users that
    // have never been restricted (all legacy users).
    accountStateChangedAt: { type: Date, default: undefined },
    // Credential generation (#207). Access tokens carry the generation they were
    // issued under; the server accepts a token only if it equals the user's
    // current value. It is incremented, in the SAME atomic write that restores
    // eligibility, when a HARD_SUSPENDED account returns to ACTIVE (admin lift
    // or expiry), so every access token issued before the restoration is
    // permanently invalid and a fresh login is required (ADR-0010 §4). Absent
    // means 0 (no backfill needed); never exposed.
    authGeneration: { type: Number, min: 0, default: undefined },
    accountRestriction: { type: accountRestrictionSchema, default: undefined },
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
        // Same defense-in-depth for governance enforcement data: a user-visible
        // projection of the restriction is an explicit DTO decision (#175).
        delete ret.accountRestriction;
        delete ret.authGeneration;
        return ret;
      },
    },
  },
);

// Enforce valid (state, restriction) combinations on save/validate. Only when
// a governance path changed (or a new document), so unrelated saves are never
// blocked by a legacy/raw record. Partial selections (fields not loaded) are
// skipped. NOTE: Mongoose does not run validators for raw update operators
// (updateOne/findOneAndUpdate); mutation services (#174-#180) must call
// `validateAccountRecord` on the resulting record and use conditional atomic
// updates that also increment `accountStateVersion` (ADR-0006; #173).
userSchema.pre("validate", function validateAccountGovernance() {
  const governancePaths = ["accountState", "accountRestriction", "accountStateChangedAt"];
  if (!governancePaths.every((p) => this.isSelected(p))) return;
  if (!this.isNew && !governancePaths.some((p) => this.isModified(p))) return;
  const errors = validateAccountRecord(this);
  if (errors.length > 0) this.invalidate("accountState", errors.join("; "));
});

// Reviewer queue (#91): partial index over pending applications only.
userSchema.index(
  { "expertApplication.status": 1, updatedAt: 1 },
  { partialFilterExpression: { "expertApplication.status": "pending" } },
);

// Account governance access paths (ADR-0010 §2/§3 server-side expiry, §10
// asynchronous deletion worker, Admin directory by state). PARTIAL so the
// ACTIVE majority carries no index entries and ACTIVE-user writes are
// unaffected. PERMANENTLY_DELETED is intentionally NOT indexed: it is terminal
// and no access path is specified (the purge worker selects DELETION_PENDING;
// ADR-0010 does not call for listing purged accounts). Add it only when a
// concrete query needs it.
userSchema.index(
  { accountState: 1, accountStateChangedAt: 1 },
  {
    name: "account_state_changed",
    partialFilterExpression: {
      accountState: {
        $in: [
          ACCOUNT_STATES.MUTED,
          ACCOUNT_STATES.HARD_SUSPENDED,
          ACCOUNT_STATES.DELETION_PENDING,
        ],
      },
    },
  },
);
userSchema.index(
  { "accountRestriction.expiresAt": 1 },
  {
    name: "account_restriction_expiry",
    partialFilterExpression: { "accountRestriction.expiresAt": { $exists: true } },
  },
);

// Admin directory ordering (#181): `createdAt DESC, _id DESC` for the unfiltered
// and role/state-filtered lists. Name-prefix search has no supporting index
// (docs/architecture/admin-directory.md).
userSchema.index({ createdAt: -1, _id: -1 }, { name: "user_directory_order" });

// Approved index: unique email (uniqueness comes from `unique: true` above;
// no separate index() call needed for this one).

export const User = mongoose.model("User", userSchema);
export default User;
