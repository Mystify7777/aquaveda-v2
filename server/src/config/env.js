/**
 * Canonical, shared environment-configuration entry point.
 *
 * This is the intentional configuration boundary for modules that need
 * shared environment access — consumers (like `db.js`) should import
 * from here rather than relying on some unrelated module to load
 * environment variables as an accidental side effect.
 *
 * `server.js` separately retains its own entry-point-level
 * `import "dotenv/config"` line. That is intentional, not an oversight
 * this file is meant to replace: it's a harmless, idempotent safeguard
 * that keeps the application's true entry point self-sufficient even if
 * this module's own import chain ever changed. `dotenv/config`'s load
 * is idempotent and a no-op once environment variables are already
 * present, so this file and `server.js` both importing it is safe and
 * does not double-load or override already-set variables — the
 * important property this file provides is a single *named*,
 * intentional place for other modules to depend on, not literal
 * exclusivity over who is allowed to call `dotenv/config`.
 *
 * Why this file exists, specifically: `db.js` previously carried the
 * `dotenv/config` import on the reasoning that "it's the only module
 * that needs env vars, and everything else needing them goes through
 * it anyway." That was true for Phase D (only `connectDB()` and the
 * test suite needed env vars), but it made env loading an accidental
 * side effect of importing the database module rather than an
 * intentional configuration boundary — a future module needing, say, a
 * JWT secret would only get a populated `process.env` because it
 * happened to import something that happened to import `db.js`. This
 * file removes that hidden coupling: it is the actual, named
 * configuration entry point, and `db.js` now imports it explicitly for
 * the same reason any other module would.
 *
 * This module intentionally does NOT read or validate any Authentication-
 * specific variables (JWT secrets, token lifetimes, cookie settings) yet
 * — those belong to later implementation phases (Phase D/E/H of the
 * implementation plan) and are not needed by anything built in this
 * phase. Adding them speculatively now, before any code actually reads
 * them, would be exactly the kind of premature configuration surface
 * this project has consistently avoided elsewhere.
 */

import "dotenv/config";

/**
 * Read a required environment variable, throwing a clear startup error
 * if it's missing rather than letting a consumer silently receive
 * `undefined` and fail later with a less legible error.
 *
 * This was previously defined locally inside `db.js`, used only for its
 * own `{ envVar }` mechanism (`MONGO_URI` / `TEST_MONGO_URI`). Moved
 * here so any future config consumer (e.g. Authentication's token
 * utilities, once that phase begins) can reuse the exact same
 * fail-clearly behavior instead of each module reinventing its own
 * missing-env-var handling.
 *
 * @param {string} name - the environment variable's name
 * @returns {string} the variable's value
 */
export function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        "See server/README.md for the expected environment variables."
    );
  }
  return value;
}

/**
 * Phase H — cookie deployment configuration.
 *
 * Resolved topology (locked, this deployment): frontend and backend are
 * on genuinely different registrable domains (real cross-site, not
 * sibling subdomains). This makes `SameSite=None` mandatory — `Lax`
 * (the previous silent default) would never send the cookie on the
 * cross-site requests this app depends on, i.e. auth would appear to
 * "randomly" fail in production only. Fail fast at startup instead of
 * letting a bad/missing value reach Express's cookie serializer.
 *
 * `Secure` for `SameSite=None` is a browser-enforced hard requirement,
 * independent of NODE_ENV — resolved here, consumed by
 * auth.routes.js's baseCookieOptions() alongside the existing
 * production-gated secure flag.
 */
const VALID_SAME_SITE_VALUES = Object.freeze(["strict", "lax", "none"]);

export function resolveCookieSameSite() {
  // Default is "none", not "lax" — this deployment's topology (frontend
  // and backend on different registrable domains) is locked, so a
  // missing COOKIE_SAME_SITE must still produce a working cross-site
  // cookie, not a silently-broken same-site one that only fails in
  // production. If a future deployment genuinely needs "lax"/"strict",
  // set COOKIE_SAME_SITE explicitly — the fallback here is not "the
  // safe generic default," it's "this deployment's locked value."
  const raw = (process.env.COOKIE_SAME_SITE || "none").toLowerCase();
  if (!VALID_SAME_SITE_VALUES.includes(raw)) {
    throw new Error(
      `Invalid COOKIE_SAME_SITE value: "${process.env.COOKIE_SAME_SITE}". ` +
        `Must be one of: ${VALID_SAME_SITE_VALUES.join(", ")}.`
    );
  }
  return raw;
}

/**
 * `COOKIE_DOMAIN` has no legitimate use in this deployment's cross-site
 * topology (the `Domain` attribute only enables sharing across
 * subdomains of the SAME registrable domain — frontend and backend
 * here are different registrable domains entirely). Left unset by
 * default; validated only if explicitly provided, so a stray value
 * doesn't silently produce a cookie the browser rejects at the network
 * layer.
 */
export function resolveCookieDomain() {
  const raw = process.env.COOKIE_DOMAIN;
  if (!raw) return undefined;

  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes(" ") || !trimmed.includes(".")) {
    throw new Error(
      `Invalid COOKIE_DOMAIN value: "${raw}". Expected a bare domain ` +
        `(e.g. "example.com"), or leave unset for a host-only cookie.`
    );
  }
  return trimmed;
}
