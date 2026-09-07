import { unauthorized, forbidden } from "./errors.js";

/**
 * Shared authorization primitives for the domain service layer.
 *
 * Locked per docs/architecture/decision-register.md, "Locked —
 * Authorization & Ownership Policy" (AUTH-L1, AUTH-L2). Consolidates
 * logic that was previously duplicated byte-for-byte across
 * issue.service.js, knowledge.service.js, comment.service.js, and
 * project.service.js.
 *
 * Consumes the same opaque `actorContext = { id, role }` every domain
 * service already receives. Knows nothing about Express, JWTs,
 * cookies, or how actorContext was produced — that boundary belongs to
 * authMiddleware (Authentication milestone), not here.
 */

/**
 * requireActor(actorContext)
 *
 * Confirms a request has *any* identified actor. Does not evaluate
 * role or ownership — those are separate concerns (requireRole below;
 * ownership checks remain operation-specific per AUTH-L3, not
 * generalized here).
 */
export function requireActor(actorContext) {
  if (!actorContext || !actorContext.id) {
    throw unauthorized("an authenticated actor is required");
  }
}

/**
 * requireRole(actorContext, role)
 *
 * Confirms the actor's role matches exactly the single required role.
 *
 * Deliberately two parameters only — no role array/set, no optional
 * per-call-site message. This is locked (AUTH-L2), not an
 * implementation convenience: Product Invariant 9 ("Experts verify.
 * Admins govern. Neither substitutes for the other.") stays
 * structurally impossible to violate only if this primitive cannot
 * accept more than one role. A call site that appears to need two
 * roles is a signal to re-examine that call site, not to widen this
 * function's signature — see the implementation plan's stop-and-flag
 * conditions.
 *
 * The thrown error message is intentionally canonical, not
 * per-call-site (this replaces 4 previously distinct English
 * sentences with one, per architecture review) — the specific role
 * and the actor's actual role are carried in `details`, not prose, so
 * callers needing that information read structured data rather than
 * parsing a message string.
 */
export function requireRole(actorContext, role) {
  if (actorContext.role !== role) {
    throw forbidden("Forbidden: insufficient role privileges", {
      requiredRole: role,
      actualRole: actorContext.role,
    });
  }
}
