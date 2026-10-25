/**
 * Frontend view of the Expert application submission contract (EXP-L9+).
 *
 * The backend domain module is the single source of truth for the expertise
 * vocabulary, limits, acknowledgement wording and every validation rule; this
 * file only re-exports it (typed) so the cross-package import path lives in
 * exactly one place, the same boundary pattern as `classification.ts` and
 * `discovery-contract.ts`. The module is pure and import-free (a backend test
 * enforces that), which is what makes it safe to share with the browser
 * bundle. Do not re-implement, copy or "adjust" any of these rules in `src/`.
 *
 * Permitted under ADR-0002: it constrains what `server/` imports (it stays
 * self-contained), not who consumes its pure modules; the build context must
 * include `server/src/domain/`.
 */
import {
  ACKNOWLEDGEMENT_TEXTS,
  AFFILIATION_MAX_LENGTH,
  CURRENT_ACKNOWLEDGEMENT_VERSION,
  EXPERIENCE_MAX_LENGTH,
  EXPERIENCE_MIN_LENGTH,
  EXPERTISE_AREAS,
  EXPERTISE_AREAS_MAX,
  EXPERTISE_AREAS_MIN,
  EXPERTISE_VALUES,
  NOTE_MAX_LENGTH,
  REFERENCES_MAX,
  REFERENCE_MAX_LENGTH,
  REJECT_NOTE_MIN_LENGTH,
  isValidRevision,
  normalizeReferenceUrl,
  validateDecisionNote,
  validateSubmission,
} from "../../../server/src/domain/expert-application-submission.js";

export {
  ACKNOWLEDGEMENT_TEXTS,
  AFFILIATION_MAX_LENGTH,
  CURRENT_ACKNOWLEDGEMENT_VERSION,
  EXPERIENCE_MAX_LENGTH,
  EXPERIENCE_MIN_LENGTH,
  EXPERTISE_AREAS,
  EXPERTISE_AREAS_MAX,
  EXPERTISE_AREAS_MIN,
  EXPERTISE_VALUES,
  NOTE_MAX_LENGTH,
  REFERENCES_MAX,
  REFERENCE_MAX_LENGTH,
  REJECT_NOTE_MIN_LENGTH,
  isValidRevision,
  normalizeReferenceUrl,
  validateDecisionNote,
  validateSubmission,
};

/** The acknowledgement wording the current contract version asks for. Never hand-copied. */
export const CURRENT_ACKNOWLEDGEMENT_TEXT: string =
  ACKNOWLEDGEMENT_TEXTS[CURRENT_ACKNOWLEDGEMENT_VERSION as keyof typeof ACKNOWLEDGEMENT_TEXTS];

const LABELS: Record<string, string> = Object.fromEntries(
  EXPERTISE_AREAS.map((a: { value: string; label: string }) => [a.value, a.label]),
);

/** Human label for a stored expertise key; an unknown key is shown verbatim, never hidden. */
export function expertiseLabel(value: string): string {
  return LABELS[value] ?? value;
}
