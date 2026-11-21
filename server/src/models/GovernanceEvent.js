import mongoose from "mongoose";
import {
  ACTOR_TYPES,
  GOVERNANCE_ACTIONS,
  REASON_MAX_LENGTH,
  SAFE_REASON_MAX_LENGTH,
  REFERENCE_TYPE_PATTERN,
  validateGovernanceEventInput,
} from "../domain/governance-event.js";

const { Schema } = mongoose;

/**
 * GovernanceEvent — account-governance audit record (#172, ADR-0010 §14),
 * append-only AT THE APPLICATION / MONGOOSE BOUNDARY. Separate from current account state (`User`): this is
 * history, never consulted for enforcement.
 *
 * Enforced here: all event-domain fields are `immutable` (`createdAt` is
 * generated metadata), existing documents cannot be saved, and every
 * update/replace/delete/bulkWrite path is rejected (GOVERNANCE_EVENT_IMMUTABLE).
 * `insertMany` / `create` are the only writes.
 *
 * NOT guaranteed here: MongoDB itself still permits mutation or deletion
 * through the raw driver (`Model.collection.*`) or any other process holding
 * write privileges, and Mongoose cannot intercept that. Making the invariant
 * authoritative requires database-level permissions (an application role with
 * insert/find but no update/delete on this collection). That is an operations
 * decision outside #172; see docs/architecture/governance-audit-events.md.
 *
 * Retry safety: `idempotencyKey` is required and uniquely indexed; the service
 * resolves duplicates (see governance-event.service.js).
 */

export const IMMUTABLE_ERROR_CODE = "GOVERNANCE_EVENT_IMMUTABLE";

const referenceSchema = new Schema(
  {
    type: { type: String, required: true, match: REFERENCE_TYPE_PATTERN, immutable: true },
    id: { type: Schema.Types.ObjectId, required: true, immutable: true },
  },
  { _id: false },
);

const governanceEventSchema = new Schema(
  {
    idempotencyKey: { type: String, required: true, immutable: true },
    action: { type: String, enum: Object.values(GOVERNANCE_ACTIONS), required: true, immutable: true },
    // USER: `actor` is the performer (an Admin, or the account owner for
    // owner-initiated actions). SYSTEM: server-side expiry / worker; no actor.
    actorType: { type: String, enum: Object.values(ACTOR_TYPES), required: true, immutable: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", default: undefined, immutable: true },
    // The affected account. Retained even after the account is purged.
    target: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    // Account state (or role, for EXPERT_*) before and after the action.
    previousState: { type: String, required: true, immutable: true },
    resultingState: { type: String, required: true, immutable: true },
    // PRIVATE enforcement reason. Never serialized (toJSON) or shown to the
    // affected user; see governance-event.dto.js.
    reason: { type: String, trim: true, maxlength: REASON_MAX_LENGTH, default: undefined, immutable: true },
    // The user-visible reason, where policy permits.
    safeReason: { type: String, trim: true, maxlength: SAFE_REASON_MAX_LENGTH, default: undefined, immutable: true },
    references: { type: [referenceSchema], default: undefined, immutable: true },
    occurredAt: { type: Date, required: true, default: Date.now, immutable: true },
  },
  {
    // createdAt only: events have no updatedAt because they are never updated.
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform(doc, ret) {
        delete ret.reason;
        delete ret.idempotencyKey;
        return ret;
      },
    },
  },
);

governanceEventSchema.pre("validate", function validateGovernanceEvent() {
  if (!this.isNew) return;
  const errors = validateGovernanceEventInput(this);
  if (errors.length > 0) this.invalidate("action", errors.join("; "));
});

function immutableError(operation) {
  const err = new Error(`GovernanceEvent is append-only at the application boundary: ${operation} is not permitted`);
  err.code = IMMUTABLE_ERROR_CODE;
  return err;
}

// Existing documents can never be saved again.
governanceEventSchema.pre("save", function rejectResave() {
  if (!this.isNew) throw immutableError("save of an existing event");
});

const BLOCKED_QUERY_OPERATIONS = [
  "updateOne",
  "updateMany",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "deleteOne",
  "deleteMany",
];
for (const op of BLOCKED_QUERY_OPERATIONS) {
  governanceEventSchema.pre(op, { document: false, query: true }, function rejectQueryMutation() {
    throw immutableError(op);
  });
}
for (const op of ["updateOne", "deleteOne"]) {
  governanceEventSchema.pre(op, { document: true, query: false }, function rejectDocumentMutation() {
    throw immutableError(`document ${op}`);
  });
}
governanceEventSchema.pre("bulkWrite", function rejectBulkWrite() {
  throw immutableError("bulkWrite");
});

// Access paths: retry resolution (unique), and a target's governance history
// (ADR-0010 §13 "governance history"; §14 affected-user visibility).
governanceEventSchema.index({ idempotencyKey: 1 }, { unique: true, name: "governance_event_idempotency" });
governanceEventSchema.index(
  { target: 1, occurredAt: -1, _id: -1 },
  { name: "governance_event_target_history" },
);

export const GovernanceEvent = mongoose.model("GovernanceEvent", governanceEventSchema);
export default GovernanceEvent;
