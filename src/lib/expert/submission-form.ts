import type { ExpertSubmission, ExpertSubmissionRequest } from "@/lib/api/types/expert-application";

import { CURRENT_ACKNOWLEDGEMENT_VERSION, validateSubmission } from "./submission-contract";

/**
 * The form's editable state. Pure helpers only: all RULES come from the shared
 * contract (`validateSubmission`); nothing here re-states a limit.
 */
export type SubmissionDraft = {
  expertiseAreas: string[];
  experience: string;
  affiliation: string;
  /** Raw inputs, blanks allowed (a row the user has added but not filled). */
  references: string[];
  acknowledged: boolean;
};

export type DraftErrors = Record<string, string>;

export function emptyDraft(): SubmissionDraft {
  return { expertiseAreas: [], experience: "", affiliation: "", references: [], acknowledged: false };
}

/**
 * Re-apply starting point: reuse the previous submission's content. The
 * acknowledgement is NEVER carried over; the applicant must accept it again.
 */
export function draftFromSubmission(submission: ExpertSubmission | null | undefined): SubmissionDraft {
  if (!submission) return emptyDraft();
  return {
    expertiseAreas: [...submission.expertiseAreas],
    experience: submission.experience,
    affiliation: submission.affiliation ?? "",
    references: [...submission.references],
    acknowledged: false,
  };
}

/** Builds the request the contract expects: blank affiliation/reference rows are omitted, not sent empty. */
export function draftToRequest(draft: SubmissionDraft): Record<string, unknown> {
  const references = draft.references.map((r) => r.trim()).filter(Boolean);
  const affiliation = draft.affiliation.trim();
  return {
    expertiseAreas: draft.expertiseAreas,
    experience: draft.experience,
    ...(affiliation ? { affiliation: draft.affiliation } : {}),
    ...(references.length > 0 ? { references } : {}),
    ...(draft.acknowledged ? { acknowledgement: { version: CURRENT_ACKNOWLEDGEMENT_VERSION } } : {}),
  };
}

/**
 * Validates with the shared contract. Error keys: expertiseAreas, experience,
 * affiliation, references.<row> (row = index in the DRAFT, not the filtered
 * list), acknowledgement.
 */
export function validateDraft(
  draft: SubmissionDraft,
): { ok: true; request: ExpertSubmissionRequest } | { ok: false; errors: DraftErrors } {
  const result = validateSubmission(draftToRequest(draft));
  if (result.ok) {
    const value = result.value as ExpertSubmissionRequest;
    return { ok: true, request: value };
  }

  const filledRows = draft.references.flatMap((r, i) => (r.trim() ? [i] : []));
  const errors: DraftErrors = {};
  for (const [key, message] of Object.entries(result.errors as Record<string, string>)) {
    const m = /^references\.(\d+)$/.exec(key);
    errors[m ? `references.${filledRows[Number(m[1])] ?? Number(m[1])}` : key] = message;
  }
  return { ok: false, errors };
}

/** Field focus order, used to move focus to the first invalid control. */
export function firstInvalidField(errors: DraftErrors, referenceRows: number): string | null {
  const order = [
    "expertiseAreas",
    "experience",
    "affiliation",
    ...Array.from({ length: referenceRows }, (_, i) => `references.${i}`),
    "references",
    "acknowledgement",
    "_",
  ];
  return order.find((k) => errors[k]) ?? Object.keys(errors)[0] ?? null;
}
