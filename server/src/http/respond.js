import { DomainErrorCode } from "../services/errors.js";

/**
 * Shared HTTP response/error-mapping utility.
 *
 * Locked per docs/architecture/decision-register.md, "Locked — Routes"
 * (ROUTE-L4, ROUTE-L5, ROUTE-L6). Used by every router mounted in
 * app.js, including auth.routes.js after its Phase 9 migration — this
 * replaces auth.routes.js's own local ERROR_STATUS_MAP/sendDomainError,
 * generalized to cover every DomainErrorCode in the codebase, not just
 * the Authentication-specific subset.
 *
 * Placed under src/http/ rather than src/services/ deliberately: this
 * is a route/HTTP-layer concern (translating a DomainError into an
 * Express response), not a domain-service-layer primitive. Mirrors the
 * same boundary already drawn between authorization.js (service layer)
 * and authMiddleware (HTTP layer) in the Authentication/Authorization
 * milestones — this file knows about DomainErrorCode, but nothing about
 * Mongoose, actorContext production, or any specific domain's business
 * rules.
 */

/**
 * ROUTE-L4: AUTHORIZATION_POLICY_UNRESOLVED shares HTTP 409 with
 * INVALID_STATE and STATE_RACE (all three represent a state/policy
 * conflict at the same HTTP-semantic level) but is never silently
 * folded into FORBIDDEN's 403 — FORBIDDEN means "this actor specifically
 * lacks permission"; AUTHORIZATION_POLICY_UNRESOLVED means "no policy
 * exists yet to evaluate anyone against," a materially different fact.
 * The `code` field in the response body (always present on failure,
 * see sendError below) is what actually distinguishes the three 409
 * cases from each other — the status code alone is not expected to.
 */
const ERROR_STATUS_MAP = Object.freeze({
  [DomainErrorCode.VALIDATION_FAILED]: 400,
  [DomainErrorCode.UNAUTHORIZED]: 401,
  [DomainErrorCode.FORBIDDEN]: 403,
  [DomainErrorCode.NOT_FOUND]: 404,
  [DomainErrorCode.TARGET_NOT_FOUND]: 404,
  [DomainErrorCode.INVALID_STATE]: 409,
  [DomainErrorCode.INVALID_PARENT]: 409,
  [DomainErrorCode.STATE_RACE]: 409,
  [DomainErrorCode.AUTHORIZATION_POLICY_UNRESOLVED]: 409,

  // Carried over from auth.routes.js's local map (ROUTE-L5, Phase 9) —
  // same codes, same meanings, now living in one shared table instead
  // of a second, router-local copy.
  [DomainErrorCode.INVALID_CREDENTIALS]: 401,
  [DomainErrorCode.EMAIL_ALREADY_REGISTERED]: 409,
  [DomainErrorCode.REFRESH_FAILED]: 401,
});

/**
 * sendSuccess(res, data, message, status = 200)
 *
 * Produces exactly { success: true, data, message } — the ApiSuccess<T>
 * shape from src/lib/api/types.ts, verbatim. No route should construct
 * a success response by hand.
 */
export function sendSuccess(res, data, message, status = 200) {
  res.status(status).json({ success: true, data, message });
}

/**
 * sendError(res, err)
 *
 * Produces the ApiFailure shape from src/lib/api/types.ts for a known,
 * mapped DomainError. For anything else (an unmapped DomainErrorCode, a
 * raw Mongoose/driver error, a bug), logs the real error server-side in
 * full and returns a fixed generic 500 body — never forwards an
 * unmapped error's .message to the client, since it could contain
 * internal detail no route author intended for public consumption.
 * This is the same principle auth.routes.js's sendDomainError already
 * established during the Authentication milestone's Phase F review;
 * this function is that principle, generalized to every router.
 */
export function sendError(res, err) {
  const status = ERROR_STATUS_MAP[err?.code];

  if (status !== undefined) {
    res.status(status).json({
      success: false,
      data: null,
      message: err.message,
      code: err.code,
    });
    return;
  }

  console.error("[http.respond] Unexpected error:", err);
  res.status(500).json({
    success: false,
    data: null,
    message: "Internal server error",
  });
}

/**
 * sendValidationError(res, zodError)
 *
 * A route-level Zod `safeParse` failure is not a thrown `DomainError`
 * (nothing reached the service layer yet), but must still produce the
 * identical `ApiFailure` shape `sendError` produces for
 * `VALIDATION_FAILED` — consistency for API consumers, not a
 * coincidence. Generalizes `auth.routes.js`'s original router-local
 * `sendValidationError` (which only `/register`/`/login` used) to
 * every router.
 */
export function sendValidationError(res, zodError) {
  res.status(400).json({
    success: false,
    data: null,
    message: zodError.issues[0]?.message || "Invalid request body",
    code: DomainErrorCode.VALIDATION_FAILED,
  });
}
