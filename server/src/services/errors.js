/**
 * Domain service error contract.
 *
 * A small, deliberately flat set of error types the service layer can
 * throw. These carry enough information for a future API layer to map
 * them to HTTP responses, but know nothing about Express, HTTP status
 * codes, or response shapes — that mapping is the API layer's job, not
 * this layer's (see persistence-design.md §7, ADR-0006's note that "the
 * exact HTTP representation belongs to the API error contract, not
 * ADR-0006").
 *
 * One class, one `code` field distinguishing the failure kind — not a
 * class hierarchy. Nine operations do not need nine error subclasses.
 */

export const DomainErrorCode = Object.freeze({
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED", // actor identity/role does not permit this action
  FORBIDDEN: "FORBIDDEN", // actor is identified and role-eligible, but a specific
  // relational rule blocks them (e.g. self-review, self-verification)
  INVALID_STATE: "INVALID_STATE", // the target is not in a state this operation accepts
  INVALID_PARENT: "INVALID_PARENT", // Comment parent rule violation
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND", // Comment's refType/refId does not resolve
  STATE_RACE: "STATE_RACE", // conditional update matched zero docs; document still exists
  AUTHORIZATION_POLICY_UNRESOLVED: "AUTHORIZATION_POLICY_UNRESOLVED", // D-3a

  // --- Authentication milestone additions (see decision-register.md
  // "Locked — Authentication" and authentication-implementation-plan.md
  // Phase I) ---
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS", // login failure — covers
  // both "email not found" and "password wrong" under one identical code
  // and message, deliberately, so a response never discloses which one
  // occurred
  EMAIL_ALREADY_REGISTERED: "EMAIL_ALREADY_REGISTERED", // registration
  // with an email that already exists. Deliberately distinct from
  // VALIDATION_FAILED: the input is syntactically valid, it conflicts
  // with existing application state, which is a different kind of
  // failure than a shape/format problem
  REFRESH_FAILED: "REFRESH_FAILED", // any reason a refresh attempt could
  // not produce a new token pair (malformed/tampered/expired refresh
  // JWT, session not found, session expired, wrong-user mismatch,
  // already-consumed/race). These collapse to one code and one generic
  // message on purpose: the atomic single-use-consume mechanism
  // (Session.findOneAndDelete with a compound filter) cannot honestly
  // distinguish these cases from its result without a second, non-atomic
  // diagnostic read this project has deliberately declined to add — see
  // authentication-implementation-plan.md's Phase C correction
});

export class DomainError extends Error {
  /**
   * @param {string} code - one of DomainErrorCode
   * @param {string} message - human-readable detail
   * @param {object} [details] - optional structured context (field name,
   *   expected vs. actual state, etc.) for the API layer to use in its
   *   own response shaping. Never contains Express req/res objects.
   */
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// Convenience constructors — not a class hierarchy, just avoids repeating
// `new DomainError(DomainErrorCode.X, ...)` at every call site.
export const notFound = (message, details) =>
  new DomainError(DomainErrorCode.NOT_FOUND, message, details);

export const unauthorized = (message, details) =>
  new DomainError(DomainErrorCode.UNAUTHORIZED, message, details);

export const forbidden = (message, details) =>
  new DomainError(DomainErrorCode.FORBIDDEN, message, details);

export const invalidState = (message, details) =>
  new DomainError(DomainErrorCode.INVALID_STATE, message, details);

export const invalidParent = (message, details) =>
  new DomainError(DomainErrorCode.INVALID_PARENT, message, details);

export const targetNotFound = (message, details) =>
  new DomainError(DomainErrorCode.TARGET_NOT_FOUND, message, details);

export const stateRace = (message, details) =>
  new DomainError(DomainErrorCode.STATE_RACE, message, details);

export const invalidCredentials = (message, details) =>
  new DomainError(DomainErrorCode.INVALID_CREDENTIALS, message, details);

export const emailAlreadyRegistered = (message, details) =>
  new DomainError(DomainErrorCode.EMAIL_ALREADY_REGISTERED, message, details);

export const refreshFailed = (message, details) =>
  new DomainError(DomainErrorCode.REFRESH_FAILED, message, details);

/**
 * D-3a marker error. Thrown by changeStatus() for the two transitions
 * whose authorization mechanism does not exist yet
 * (acknowledged -> in_progress, in_progress -> resolved). Deliberately
 * NOT the same code as an ordinary UNAUTHORIZED failure — an ordinary
 * unauthorized failure means "this actor is not allowed"; this means
 * "no one can be correctly evaluated for this yet, because the
 * authorization policy itself does not exist." Conflating the two would
 * misrepresent an unresolved architectural dependency as a normal access
 * check, which is exactly what this project has been careful not to do.
 */
export const authorizationPolicyUnresolved = (message, details) =>
  new DomainError(DomainErrorCode.AUTHORIZATION_POLICY_UNRESOLVED, message, details);
