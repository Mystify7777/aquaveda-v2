import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import { getRequiredEnv } from "../config/env.js";

/**
 * Authentication token and credential utilities.
 *
 * Isolates password hashing, JWT signing/verification, and refresh-
 * credential hashing from `auth.service.js`'s business logic — mirrors
 * Phase D's existing separation of concerns (schema vs. service vs.
 * error contract), applied here to crypto/token mechanics specifically.
 *
 * Locked architecture this file implements
 * (decision-register.md "Locked — Authentication",
 * authentication-implementation-plan.md Phases A/D):
 * - Access JWT payload: `{ sub }` only. No `role`, no `sid`, no other
 *   claim. Role is never trusted from a token — it is always resolved
 *   fresh from the database by whichever code verifies an access token
 *   (the future auth middleware, not this file).
 * - Refresh JWT payload: `{ sub, sid }`. `sid` is the `Session`
 *   document's own `_id`, needed so a refresh request can be resolved
 *   to the exact `Session` being rotated.
 * - Password hashing uses `node:crypto`'s `scrypt` — no new dependency
 *   for this specific concern, per the implementation plan's stated
 *   default.
 * - Refresh-token hashing is a SEPARATE, faster mechanism (SHA-256),
 *   never the same function as password hashing — a refresh token is a
 *   high-entropy random value, not a low-entropy human-chosen secret,
 *   so a deliberately slow adaptive hash buys no security benefit here
 *   and only adds CPU cost on every refresh request.
 */

// ---------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------

// scrypt parameters. Centralized here, not scattered across call sites,
// specifically so they can be upgraded later (e.g. a higher cost factor
// as hardware improves) without touching any caller. Values chosen are
// Node's own documented reasonable defaults for interactive-login-speed
// hashing, not a bespoke tuning exercise.
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });

const scryptAsync = (password, salt) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      SCRYPT_PARAMS,
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      }
    );
  });

/**
 * Hash a plaintext password for storage.
 *
 * Stored format (single string, colon-delimited):
 *   scrypt:N:r:p:<saltHex>:<hashHex>
 *
 * The cost parameters are embedded in the stored value itself (not just
 * assumed from the current `SCRYPT_PARAMS` constant) so that a future
 * parameter upgrade doesn't break verification of passwords hashed
 * under the old parameters — `verifyPassword` reads the parameters back
 * out of the stored string rather than assuming today's constants.
 *
 * @param {string} plaintext
 * @returns {Promise<string>} the stored hash format, safe to persist in
 *   `User.passwordHash`
 */
export async function hashPassword(plaintext) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const derivedKey = await scryptAsync(plaintext, salt);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt:${N}:${r}:${p}:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

/**
 * Strict hex-string check: non-empty, even length (hex encodes whole
 * bytes), only [0-9a-fA-F]. Used to validate `verifyPassword`'s stored
 * salt/hash fields explicitly, since `Buffer.from(str, "hex")` does not
 * throw on invalid input — see the correction note in `verifyPassword`.
 *
 * @param {string} str
 * @returns {boolean}
 */
function isValidHex(str) {
  return (
    typeof str === "string" &&
    str.length > 0 &&
    str.length % 2 === 0 &&
    /^[0-9a-fA-F]+$/.test(str)
  );
}

/**
 * Validates a parsed scrypt cost parameter (N, r, or p) against a
 * shape/bounds check, used by `verifyPassword` to reject an obviously
 * invalid or adversarially-crafted stored hash before ever attempting
 * the actual (potentially expensive) scrypt computation.
 *
 * @param {number} value
 * @param {{ min: number, max: number, powerOfTwo?: boolean }} options
 * @returns {boolean}
 */
function isValidScryptParam(value, { min, max, powerOfTwo = false }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    return false;
  }
  if (powerOfTwo && (value & (value - 1)) !== 0) {
    // scrypt's cost parameter N is required to be a power of two;
    // node:crypto enforces this internally too, but rejecting it here
    // means we never even attempt the call for an obviously malformed
    // value.
    return false;
  }
  return true;
}

/**
 * Verify a plaintext password against a stored hash produced by
 * `hashPassword`.
 *
 * Uses `crypto.timingSafeEqual` for the actual comparison — a plain
 * `===`/string comparison on hash bytes is a timing-attack surface
 * (comparison time leaks how many leading bytes matched); this project
 * does not accept that shortcut even under its proportionate-security
 * posture, since a constant-time comparison costs nothing extra here.
 *
 * Returns `false` (never throws) for a malformed/unrecognized stored
 * format, so a corrupted or unexpected `passwordHash` value fails
 * verification safely rather than crashing the login attempt.
 *
 * @param {string} plaintext
 * @param {string} stored - a `hashPassword()`-produced string
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plaintext, stored) {
  if (typeof stored !== "string") return false;

  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;

  // Review-pass correction: explicit hex validation, added because
  // `Buffer.from(str, "hex")` does NOT throw on invalid hex input —
  // it silently stops decoding at the first invalid byte pair and
  // returns a truncated buffer instead of raising an error. The
  // previous try/catch around `Buffer.from` below was therefore dead
  // code for this specific failure mode: malformed hex would silently
  // produce a wrong-length (or wrong-content) buffer rather than ever
  // reaching the catch block. A malformed stored hash must be rejected
  // explicitly, not rely on an incidental length mismatch further down
  // to eventually catch it.
  if (!isValidHex(saltHex) || !isValidHex(hashHex)) {
    return false;
  }

  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);

  // Review-pass correction: explicit bounds/shape validation for the
  // scrypt cost parameters, rather than relying solely on the
  // try/catch around the scrypt call itself to reject bad values.
  // node:crypto's `scrypt` does validate N/r/p internally (e.g. N must
  // be a power of two, and N*r*128 must not exceed its default memory
  // limit) and the try/catch below still guards against that as
  // defense-in-depth — but validating explicitly here makes the
  // accepted shape of a stored hash self-documenting, and avoids ever
  // attempting an expensive/resource-consuming scrypt call for a value
  // that's already obviously invalid (e.g. a deliberately huge N meant
  // to waste CPU/memory on every login attempt against a corrupted or
  // adversarial stored value).
  if (!isValidScryptParam(N, { min: 2, max: 1 << 20, powerOfTwo: true })) {
    return false;
  }
  if (!isValidScryptParam(r, { min: 1, max: 1024 })) {
    return false;
  }
  if (!isValidScryptParam(p, { min: 1, max: 1024 })) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (salt.length === 0 || expected.length === 0) {
    // isValidHex already requires a non-empty, even-length hex string,
    // so this should be unreachable in practice — kept as an explicit
    // guard rather than trusting that invariant silently.
    return false;
  }

  // This scrypt call remains wrapped in try/catch as defense-in-depth
  // (see the comment above) even though the explicit validation above
  // should make node:crypto's own internal rejections unreachable for
  // any value that gets this far.
  let actual;
  try {
    actual = await new Promise((resolve, reject) => {
      crypto.scrypt(plaintext, salt, expected.length, { N, r, p }, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
  } catch {
    return false;
  }

  // timingSafeEqual throws if the two buffers have different lengths —
  // guard explicitly rather than letting a length mismatch (which could
  // itself leak information via a thrown-vs-not-thrown timing
  // difference in some environments) escape as an unhandled exception.
  if (actual.length !== expected.length) return false;

  return crypto.timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------
// JWT signing/verification
// ---------------------------------------------------------------------

// Split access/refresh secrets (locked): a leaked access secret and a
// leaked refresh secret have very different blast radii, and separate
// secrets mean a refresh token can never be replayed as if it were an
// access token (or vice versa) even by accident. Read lazily (inside
// the functions below, not at module-load time) so importing this file
// doesn't itself require the env vars to be set — only actually signing
// or verifying a token does, matching `connectDB()`'s existing
// fail-clearly-at-point-of-use pattern rather than failing at import
// time.

const ACCESS_TOKEN_EXPIRES_DEFAULT = "15m";
const REFRESH_TOKEN_EXPIRES_DEFAULT = "7d";

function getAccessSecret() {
  return getRequiredEnv("JWT_ACCESS_SECRET");
}

function getRefreshSecret() {
  return getRequiredEnv("JWT_REFRESH_SECRET");
}

function getAccessExpires() {
  return process.env.JWT_ACCESS_EXPIRES || ACCESS_TOKEN_EXPIRES_DEFAULT;
}

function getRefreshExpires() {
  return process.env.JWT_REFRESH_EXPIRES || REFRESH_TOKEN_EXPIRES_DEFAULT;
}

/**
 * Sign an access token. Payload is `{ sub }` ONLY — no role, no sid, no
 * other claim. Role is never carried in the access token; it is always
 * resolved fresh from the database by whatever verifies this token.
 *
 * @param {{ sub: string }} params
 * @returns {string} signed JWT
 */
export function signAccessToken({ sub }) {
  return jwt.sign({ sub }, getAccessSecret(), {
    expiresIn: getAccessExpires(),
  });
}

/**
 * Sign a refresh token. Payload is `{ sub, sid }` — `sid` is the
 * `Session` document's own `_id`, needed to resolve the exact session a
 * refresh request is rotating. Never carries `role`.
 *
 * @param {{ sub: string, sid: string }} params
 * @returns {string} signed JWT
 */
export function signRefreshToken({ sub, sid }) {
  return jwt.sign({ sub, sid }, getRefreshSecret(), {
    expiresIn: getRefreshExpires(),
  });
}

/**
 * Verify an access token's signature and expiry.
 *
 * @param {string} token
 * @returns {{ sub: string }} the decoded payload
 * @throws {Error} (jsonwebtoken's own JsonWebTokenError/TokenExpiredError)
 *   if the token is malformed, tampered, or expired — callers (the
 *   future auth middleware) are responsible for translating this into
 *   whatever they need it to mean (e.g. "no valid actor"), not this
 *   file, which stays HTTP/DomainError-agnostic like every other
 *   utility in this project.
 */
export function verifyAccessToken(token) {
  const decoded = jwt.verify(token, getAccessSecret());
  return { sub: decoded.sub };
}

/**
 * Verify a refresh token's signature and expiry.
 *
 * @param {string} token
 * @returns {{ sub: string, sid: string }} the decoded payload
 * @throws {Error} same contract as verifyAccessToken
 */
export function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, getRefreshSecret());
  return { sub: decoded.sub, sid: decoded.sid };
}

// ---------------------------------------------------------------------
// Refresh-token hashing (for Session.tokenHash) — deliberately NOT the
// same mechanism as password hashing, see header comment.
// ---------------------------------------------------------------------

/**
 * Hash a raw refresh token (the signed JWT string itself) for
 * persistence in `Session.tokenHash`. SHA-256 — fast, deterministic,
 * appropriate for a high-entropy value where the threat scrypt/bcrypt
 * defend against (offline brute-force against a guessable secret)
 * doesn't apply.
 *
 * @param {string} rawToken
 * @returns {string} hex-encoded SHA-256 digest
 */
export function hashRefreshToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
