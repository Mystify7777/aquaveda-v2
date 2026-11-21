import { ACCOUNT_STATES } from "../domain/account-state.js";
import { sendError } from "../http/respond.js";
import { DomainErrorCode } from "../services/errors.js";

/**
 * MUTE enforcement (#174; ADR-0010 §2). A MUTED account is authenticated and
 * read-capable but cannot contribute.
 *
 * FAIL-CLOSED by construction: every non-safe HTTP method (anything other than
 * GET/HEAD/OPTIONS) from a MUTED actor is rejected with ACCOUNT_MUTED unless it
 * is explicitly classified as non-contribution below. A contribution endpoint
 * added in the future is therefore blocked by default; nothing has to remember
 * to opt in. Frontend button hiding is never relied on.
 *
 * Mounted after authMiddleware (which computes the EFFECTIVE state, including
 * expiry) and accountStateMiddleware, and before every domain router. The
 * /api/v1/auth routes are mounted before it, so login, refresh, logout and /me
 * remain available to a muted user: they are session/identity operations, not
 * contributions, and are therefore classified non-contribution by position.
 *
 * Classification (documented in docs/architecture/mute-enforcement.md):
 *  - Reads (GET/HEAD/OPTIONS): allowed.
 *  - /api/v1/auth/*: allowed (outside this guard).
 *  - Every other write, including Issue reporting, Comments/Replies,
 *    Discussions, Knowledge submission/revision, Projects, lifecycle and
 *    remediation actions, Expert application, discussion reporting and
 *    moderation: blocked. There are deliberately NO per-feature exceptions.
 *
 * Operations that ADR-0010 will need to stay available while muted (appeals,
 * user-owned deletion/recovery) do not exist yet; when they do, they must be
 * added here explicitly, with a documented reason.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Explicit non-contribution WRITE operations allowed for MUTED accounts, as
 * `{ method, pattern: RegExp, reason }` entries matched against req.path.
 * Empty today by design.
 */
export const NON_CONTRIBUTION_WRITE_ALLOWLIST = Object.freeze([]);

function isAllowlisted(req) {
  return NON_CONTRIBUTION_WRITE_ALLOWLIST.some(
    (entry) => entry.method === req.method && entry.pattern.test(req.path),
  );
}

export function contributionRestrictionMiddleware(req, res, next) {
  if (req.accountState !== ACCOUNT_STATES.MUTED) {
    next();
    return;
  }
  if (SAFE_METHODS.has(req.method) || isAllowlisted(req)) {
    next();
    return;
  }
  sendError(res, {
    code: DomainErrorCode.ACCOUNT_MUTED,
    message: "Account is muted: contribution is temporarily restricted",
  });
}

export default contributionRestrictionMiddleware;
