/**
 * Issue classification contract (Issue #67) — the single source of truth
 * for Issue `category` and `severity`.
 *
 * Consumed by: Zod validation (validation/issue.validation.js), the Issue
 * Mongoose schema (models/Issue.js), and — via direct import — the
 * frontend reporting form and API types. No other list of these values
 * may exist.
 *
 * Dependency-free plain JS on purpose so both the Express service and the
 * Next.js app can import it. `value` is the stable machine-readable
 * identifier (persisted, sent over the API, never renamed); `label` and
 * `description` are user-facing copy and may be reworded freely.
 *
 * Adding a value: append an entry here (never rename/reuse an existing
 * `value`), update docs/domain/domain-model.md, add a test. Nothing else
 * should need a list edit.
 *
 * Semantics:
 * - category: what kind of water problem was observed. Lay observation,
 *   not a technical diagnosis.
 * - severity: impact/urgency of the problem on people or the environment.
 *   NOT reporter confidence, fix difficulty/cost, or moderation priority.
 */

export const ISSUE_CATEGORIES = /** @type {const} */ ([
  {
    value: "supply_shortage",
    label: "No or low water supply",
    description: "Water is not arriving, or arriving far less than usual.",
  },
  {
    value: "leakage_wastage",
    label: "Leak or wastage",
    description: "Visible leaking, overflowing, or wasted water.",
  },
  {
    value: "water_quality",
    label: "Water quality concern",
    description: "Unusual colour, smell, taste, or visible pollution.",
  },
  {
    value: "flooding_drainage",
    label: "Flooding or drainage",
    description: "Standing water, waterlogging, or blocked drains.",
  },
  {
    value: "damaged_infrastructure",
    label: "Damaged water facility",
    description: "A pump, tank, tap, well, or pipeline that is broken or not working.",
  },
  {
    value: "other",
    label: "Other water issue",
    description: "A water-related problem that fits none of the above.",
  },
]);

export const ISSUE_SEVERITIES = /** @type {const} */ ([
  {
    value: "low",
    label: "Low",
    description: "Minor; little effect on daily water use or safety.",
  },
  {
    value: "medium",
    label: "Medium",
    description: "Noticeable disruption or ongoing waste, but not immediately harmful.",
  },
  {
    value: "high",
    label: "High",
    description: "Serious disruption or risk affecting many people or the environment.",
  },
  {
    value: "critical",
    label: "Critical",
    description: "Immediate risk to health or safety, or a severe emergency.",
  },
]);

/** Derived machine-value lists (runtime use: validation, schema enums). */
export const ISSUE_CATEGORY_VALUES = ISSUE_CATEGORIES.map((c) => c.value);
export const ISSUE_SEVERITY_VALUES = ISSUE_SEVERITIES.map((s) => s.value);
