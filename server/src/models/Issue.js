import mongoose from "mongoose";

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
      // Deliberately NOT role-gated or Project-membership-gated here.
      // D-3a (remediation-assertion authority) is unresolved by design —
      // this field stays a neutral User reference so the eventual
      // authorization mechanism can be layered on in the service layer
      // without a schema migration. See decision-register.md D-3a.
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { _id: true }, // default Mongoose behavior kept; each entry gets a stable id
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
 * - D-3a (authorized remediation actor mechanism) — unresolved by design
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
  },
  { timestamps: true },
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
