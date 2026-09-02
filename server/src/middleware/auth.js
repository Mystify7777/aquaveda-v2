import { User } from "../models/User.js";
import { verifyAccessToken } from "../services/auth-tokens.js";

/**
 * Authentication middleware.
 *
 * Per docs/architecture/decision-register.md's "Locked — Authentication"
 * section and authentication-implementation-plan.md Phase E, this
 * middleware is the SOLE, EXCLUSIVE owner of request-actor resolution.
 * No other file — including auth.service.js — independently resolves an
 * actor from a token. Any route needing to know who's making the
 * request reads `req.actorContext`, set here and nowhere else.
 *
 * Cookie name: `access_token` (a naming choice, not an architectural
 * one — the plan explicitly left this TBD; flagged here as the concrete
 * value chosen, easy to change in one place if reviewed differently).
 *
 * This middleware reads `req.cookies.access_token`, which only exists
 * once `cookie-parser` is mounted globally in app.js. Per the
 * implementation plan's own step sequencing (Phase F, not Phase E),
 * that mounting has NOT happened yet — this file can be written and
 * unit-tested (by constructing `req.cookies` directly) without it, but
 * it will not receive real cookies until `cookie-parser` is added and
 * wired in app.js during the routes phase.
 *
 * Advisory, not enforcing: this middleware NEVER rejects a request by
 * itself. Per Product Invariant 5 ("Anonymous users may explore" —
 * browsing the map, reading approved knowledge, and viewing issues
 * never requires an account), a request with no cookie, an expired
 * token, or any other resolution failure simply gets
 * `req.actorContext = null` — the same "no actor" state Phase D's
 * services already handle via their own `requireActor()` check
 * (`!actorContext || !actorContext.id` → throws UNAUTHORIZED). This
 * middleware does not duplicate that check or decide which routes
 * require an actor; it only makes the actor available, or explicitly
 * absent, for whatever consumes it next.
 *
 * D-3a is untouched by this file. It has zero awareness of Issue
 * status, lifecycle, or AUTHORIZATION_POLICY_UNRESOLVED. It produces
 * `{ id, role }` and stops — the two D-3a-gated Issue transitions
 * continue to be evaluated exclusively inside issue.service.js's
 * authorizeTransition(), completely unaffected by real roles now being
 * reliably resolvable here.
 */

export const ACCESS_TOKEN_COOKIE_NAME = "access_token";

/**
 * Resolves `req.actorContext` from the access-token cookie, if present
 * and valid, per L11 (role always read fresh from the database, never
 * trusted from the token itself).
 *
 * Steps, matching the implementation plan exactly:
 * 1. Extract the access-token cookie.
 * 2. If absent, actorContext = null (not a rejection).
 * 3. Verify the JWT's signature and expiry.
 * 4. On success, look up the User by `sub` for a FRESH role read.
 * 5. Build `{ id, role }` — the exact shape every Phase D service
 *    already destructures. No other fields, ever.
 * 6. Attach to `req.actorContext` (or `null` on any failure at any
 *    step above).
 */
export async function authMiddleware(req, res, next) {
  req.actorContext = null;

  const token = req.cookies?.[ACCESS_TOKEN_COOKIE_NAME];
  if (!token) {
    next();
    return;
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    // Malformed, tampered, or expired access JWT. jsonwebtoken's raw
    // exception (JsonWebTokenError, TokenExpiredError, etc.) is
    // deliberately not inspected or re-thrown here — this middleware
    // never leaks library-specific error detail, the same principle
    // already applied to auth.service.js's refresh() error handling.
    // Treated identically to a missing cookie: no valid actor.
    next();
    return;
  }

  let user;
  try {
    user = await User.findById(decoded.sub);
  } catch {
    // A malformed `sub` (not a valid ObjectId) throws a Mongoose
    // CastError here — still just "no valid actor" from this
    // middleware's perspective, not a distinct failure to report.
    next();
    return;
  }

  if (!user) {
    // The user no longer exists (deleted between token issuance and
    // this request). This is the concrete mechanism correcting V1's
    // specific defect: a still-cryptographically-valid access token
    // must NOT resolve to an actor once its underlying User is gone.
    next();
    return;
  }

  // Fresh role resolution (L11): role comes from the User document
  // read just now, never from the token payload (which never carried
  // a role in the first place — see L10/L16).
  req.actorContext = { id: user._id, role: user.role };
  next();
}

export default authMiddleware;
