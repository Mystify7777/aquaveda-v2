import { z } from "zod";

import { objectIdString } from "./shared/objectId.js";
import { paginationQuerySchema } from "./shared/pagination.js";

import {
  isValidRevision,
  validateDecisionNote,
  validateSubmission,
} from "../domain/expert-application-submission.js";

/**
 * Expert-application request shapes (#91, extended by EXP-L9+).
 *
 * Bodies are `.strict()`: NO schema accepts role, status, applicant, reviewer or
 * a server-side timestamp/hash, so a smuggled `role: "EXPERT"` is a 400 rather
 * than a silently-ignored field.
 *
 * The submission and note RULES live in the pure domain module (shared with the
 * frontend). These schemas only adapt that single implementation to Zod, so the
 * two cannot drift.
 */
export const applicantIdParamSchema = z.object({ userId: objectIdString });

/** Surface a domain-validator's field errors as Zod issues (path = the field). */
function addFieldIssues(errors, ctx) {
  for (const [field, message] of Object.entries(errors)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path: field === "_" ? [] : field.split("."),
    });
  }
}

/**
 * POST /  — loose shape here (so type errors surface per field from the domain
 * validator), strictness and all content rules in `validateSubmission`.
 */
export const applyExpertApplicationSchema = z.unknown().transform((input, ctx) => {
  const result = validateSubmission(input);
  if (!result.ok) {
    addFieldIssues(result.errors, ctx);
    return z.NEVER;
  }
  return result.value;
});

const revisionSchema = z.custom((v) => isValidRevision(v), {
  message: "revision must be the integer revision of the application you reviewed",
});

function decisionSchema({ noteRequired }) {
  return z
    .object({ revision: revisionSchema, note: z.unknown().optional() })
    .strict()
    .transform((body, ctx) => {
      const note = validateDecisionNote(body.note, { required: noteRequired });
      if (!note.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: note.reason, path: ["note"] });
        return z.NEVER;
      }
      return { revision: body.revision, note: note.value };
    });
}

export const approveExpertApplicationSchema = decisionSchema({ noteRequired: false });
export const rejectExpertApplicationSchema = decisionSchema({ noteRequired: true });

export const pendingExpertApplicationsQuerySchema = paginationQuerySchema;
