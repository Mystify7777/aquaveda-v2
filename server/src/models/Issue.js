import mongoose from "mongoose";

import { LOCATION_LABEL_MAX_LENGTH } from "../domain/location-label.js";
import { NOTE_MAX_LENGTH } from "../domain/lifecycle-note.js";
import { REMEDIATION_EVENT_TYPES } from "../domain/remediation.js";
import {
  ISSUE_CATEGORY_VALUES,
  ISSUE_SEVERITY_VALUES,
} from "../domain/issue-classification.js";

const { Schema } = mongoose;

/**
 * Issue.statusHistory entry
 *
 * Embedded subdocument, per ADR-0005. Records one lifecycle event —
 * either the initial `null -> open` creation entry, or a subsequent
 * status transition (ADR-0003).
 *
 * Schema-enforceable here:
 * - `fromStatus` / `toStatus` enum membership (including `null` for the
 *   initial entry)
 * - required fields
 *
 * NOT enforced here (service layer, ADR-0006):
 * - whether a given fromStatus -> toStatus edge is a legal transition
 * - `resolverId !== verifierId` (cross-entry, contextual — requires
 *   reading a prior history entry, not expressible as a static schema
 *   rule; see persistence-design.md §6)
 * - that `fromStatus` matches the state that was actually current at
 *   write time (this is the conditional-atomic-update invariant from
 *   ADR-0006, enforced by the write operation itself, not by the schema)
 */
const ISSUE_STATUSES = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "verified",
];

const issueStatusHistoryEntrySchema = new Schema(
  {
    fromStatus: {
      type: String,
      enum: [null, ...ISSUE_STATUSES],
      default: null,
      // The enum above only says "null is a structurally valid value for
      // this field, generally." It does NOT and cannot express the actual
      // domain rule: `fromStatus: null` is valid *only* for an Issue's
      // first history entry (the `null -> open` creation event, per
      // ADR-0005), and is invalid for every subsequent entry. Enforcing
      // "null only on entry index 0" requires inspecting the rest of the
      // array relative to this entry's position — a contextual,
      // whole-document check, not a per-field constraint. This is a
      // service-layer invariant (the `createIssue`/`changeStatus`
      // operations are the only code paths that append to this array,
      // and only `createIssue` may ever write `fromStatus: null`), not
      // something this schema enforces or can enforce.
    },
    toStatus: {
      type: String,
      enum: ISSUE_STATUSES,
      required: true,
    },
    actor: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      // Deliberately NOT role-gated or Project-membership-gated here: this is
      // a neutral User reference recording who performed the transition.
      // Remediation authority is NOT derived from it; it comes only from an
      // accepted grant (`remediation`, ADR-0007, which resolved D-3a).
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // Optional explanation of the transition (ADR-0007 §6): resolution
    // statement, verification rationale, rejection reason. Untrusted plain
    // text, normalized/required-ness enforced by the service; absent on
    // legacy entries. PUBLIC by ADR-0007 §7 (unlike remediationHistory notes).
    note: {
      type: String,
      maxlength: NOTE_MAX_LENGTH,
    },
  },
  { _id: true }, // default Mongoose behavior kept; each entry gets a stable id
);

// Current remediation grant (ADR-0007 §1). Absent = unassigned; acceptedAt
// null = pending, a Date = accepted. The ONLY source of remediation
// authority. `grantId` is the stable identity of this specific grant and is
// part of every grant-dependent conditional write (ADR-0007 §4), so a stale
// operation can never act on a replacement grant.
const remediationGrantSchema = new Schema(
  {
    grantId: { type: Schema.Types.ObjectId, required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true }, // the grantee
    grantedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    grantedAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
  },
  { _id: false },
);

// Append-only audit trail of responsibility changes (ADR-0007 §5). Deliberately
// separate from statusHistory (different shape, events and audience;
// ADR-0005: no generic shared history abstraction).
const remediationEventSchema = new Schema(
  {
    type: { type: String, enum: REMEDIATION_EVENT_TYPES, required: true },
    grantId: { type: Schema.Types.ObjectId, required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true }, // performer
    grantee: { type: Schema.Types.ObjectId, ref: "User", required: true },
    timestamp: { type: Date, required: true },
    note: { type: String, maxlength: NOTE_MAX_LENGTH },
    // Only on `granted` events that were self-grants: the policy basis (private).
    selfGrant: { type: Boolean },
    expertCount: { type: Number },
    threshold: { type: Number },
  },
  { _id: false },
);

/**
 * Issue
 *
 * Schema-enforceable constraints (this file):
 * - required fields, type correctness
 * - `status` enum membership
 * - `location` GeoJSON Point shape + 2dsphere index
 * - `reportedBy` required + immutable (best-effort — see note below)
 *
 * NOT enforced here (service layer):
 * - legality of a status transition (ADR-0003's transition graph)
 * - transition authority (who may perform which transition)
 * - remediation authority (ADR-0007: an accepted `remediation` grant is the only source)
 * - `immutable: true` on `reportedBy` is defense-in-depth only; it guards
 *   `.save()` but does not stop every possible update path (e.g. a raw
 *   `updateOne`). The real guarantee is that no service operation ever
 *   exposes `reportedBy` as an updatable field. See persistence-design.md §6.
 *
 * `category` and `severity` are constrained to the canonical vocabulary
 * in domain/issue-classification.js (Issue #67, decision-register D-9),
 * plus "" meaning "not classified" (the default). The enum is
 * defense-in-depth for create/save; reads never re-validate. No legacy
 * free-text data is assumed to exist — see domain-model.md, "Read-type
 * assumption".
 */
const locationSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["Point"],
      required: true,
      default: "Point",
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      validate: {
        validator: function (value) {
          // Structural GeoJSON Point requirement only: exactly two
          // finite numbers. This is a shape constraint, genuinely
          // schema-enforceable without contextual/cross-document data.
          return (
            Array.isArray(value) &&
            value.length === 2 &&
            value.every((n) => typeof n === "number" && Number.isFinite(n))
          );
        },
        message:
          "coordinates must be an array of exactly two finite numbers [longitude, latitude]",
      },
    },
  },
  { _id: false },
);
// Geographic range validation (longitude in [-180, 180], latitude in
// [-90, 90]) is deliberately NOT enforced here — that belongs at the
// Zod/service validation layer, consistent with persistence-design.md §7's
// division: Mongoose owns structural shape, not domain-meaningful range
// checks on otherwise-valid numbers.

const issueSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    location: {
      type: locationSchema,
      required: true,
    },
    // Optional, reporter-supplied, UNTRUSTED display text (#134;
    // domain/location-label.js). Never geometry: `location` above is the
    // only authoritative position. Absent on legacy/GPS/manual-coordinate
    // issues; no default, no index, no migration.
    locationLabel: {
      type: String,
      trim: true,
      maxlength: LOCATION_LABEL_MAX_LENGTH,
    },
    severity: {
      type: String,
      enum: ["", ...ISSUE_SEVERITY_VALUES],
      default: "",
    },
    category: {
      type: String,
      enum: ["", ...ISSUE_CATEGORY_VALUES],
      default: "",
    },
    domain: {
      type: String,
      default: "water",
    },
    status: {
      type: String,
      enum: ISSUE_STATUSES,
      required: true,
      default: "open",
    },
    reportedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true, // defense-in-depth only; see note above
    },
    statusHistory: {
      type: [issueStatusHistoryEntrySchema],
      default: [],
      // Includes the initial `null -> open` entry at creation, per
      // ADR-0005 — statusHistory is the complete lifecycle history, not
      // only post-creation transitions. Populating that initial entry is
      // a service-layer responsibility at creation time (Phase D), not
      // something this schema can default on its own, since it needs
      // `reportedBy` and `createdAt` values that only exist once the
      // document is being created.
    },
    // ADR-0007. Both fields are PRIVATE workflow state: they are stripped from
    // every JSON serialization below, and public/workflow views are produced
    // only by the pure projections in domain/issue-activity.js.
    remediation: {
      type: remediationGrantSchema,
      default: undefined, // absent on unassigned and on all pre-existing Issues
    },
    remediationHistory: {
      type: [remediationEventSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      // Routes serialize raw documents (`sendSuccess(res, doc)`), and Mongoose
      // returns every stored field on read. Without this, pending grantees and
      // private notes would leak through every public/PATCH response (#140
      // finding M1). Internal code still reads these as document properties;
      // `toObject()` is unaffected.
      transform(_doc, ret) {
        delete ret.remediation;
        delete ret.remediationHistory;
        return ret;
      },
    },
  },
);

// Approved indexes only (persistence-design.md §6 / ADR-0005):
issueSchema.index({ location: "2dsphere" });
issueSchema.index({ status: 1 });
issueSchema.index({ reportedBy: 1 });
// Issue #41: public text search (`q`) over title + description. Whole-word
// matching with no stemming/stop-words (`default_language: "none"`) so
// multilingual reports behave predictably. See
// docs/architecture/issue-discovery-contract.md.
issueSchema.index(
  { title: "text", description: "text" },
  { name: "issue_text_search", default_language: "none" },
);

export const Issue = mongoose.model("Issue", issueSchema);
export default Issue;
