import { z } from "zod";

import { objectIdString } from "./shared/objectId.js";

/**
 * Request-SHAPE validation for the Issue lifecycle/remediation routes (#142).
 *
 * Zod checks only types and the identity of the grantee. Note normalization,
 * the 2000-character bound and "required, non-empty" are owned by the domain
 * (domain/lifecycle-note.js via the services) and run AFTER authorization
 * (ADR-0007 amendment 3), so a missing required note is deliberately NOT a
 * schema error here: an unauthorized caller must learn nothing from it.
 */
const note = z.string({ invalid_type_error: "note must be a string" }).nullish();

export const noteBodySchema = z.object({ note });

export const grantRemediationSchema = z.object({
  granteeId: objectIdString,
  note,
});
