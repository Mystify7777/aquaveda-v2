/**
 * Frontend view of the Issue location-label contract (#134).
 *
 * The backend domain module is the single source of truth for what a
 * `locationLabel` may contain; this file only re-exports it (typed), same
 * boundary pattern as `discovery-contract.ts` (#82) and `classification.ts`
 * (#67). The module is pure (no imports). Do not re-implement these rules.
 *
 * A label is untrusted, reporter-supplied display text: render it as plain
 * text only, never as HTML, and never derive geometry, eligibility or
 * authorization from it. Coordinates (`Issue.location`) stay authoritative.
 */
import {
  LOCATION_LABEL_MAX_LENGTH,
  compactLocationLabel,
  locationLabelProblem,
  normalizeLocationLabel,
} from "../../../server/src/domain/location-label.js";

export {
  LOCATION_LABEL_MAX_LENGTH,
  compactLocationLabel,
  locationLabelProblem,
  normalizeLocationLabel,
};
