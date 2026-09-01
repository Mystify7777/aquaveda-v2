import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import {
  invalidCredentials,
  emailAlreadyRegistered,
  refreshFailed,
  DomainError,
  DomainErrorCode,
} from "./errors.js";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
} from "./auth-tokens.js";

/**
 * Authentication domain service.
 *
 * Implements register, login, refresh, and logout, per
 * docs/architecture/decision-register.md's "Locked — Authentication"
 * section and authentication-implementation-plan.md Phase C.
 *
 * Deliberately does NOT implement request-actor resolution
 * (verify-access-token -> load User -> build actorContext). That
 * responsibility belongs exclusively to the future auth middleware
 * (implementation plan Phase E), not this service — see the plan's
 * explicit correction on this point. This file has no "resolveActor"
 * or equivalent export.
 *
 * This module receives no Express req/res objects and knows nothing
 * about cookies, HTTP status codes, or routing — that's the future
 * routes layer's job (Phase F), consistent with every existing Phase D
 * service file's own boundary.
 *
 * D-3a is untouched by this file. Nothing here reads, writes, or
 * reasons about Issue status/lifecycle, and nothing here grants,
 * implies, or resolves remediation-assertion authority. This service
 * produces identity; it does not touch authorization policy.
 */

function wrapMongooseValidationError(err) {
  if (err.name === "ValidationError" || err.name === "CastError") {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, err.message, {
      cause: err.name,
    });
  }
  return err;
}

// MongoDB duplicate-key error code (E11000). Distinct from Mongoose's
// own ValidationError/CastError — this is a raw driver-level error
// surfaced through Mongoose on a unique-index violation at the actual
// write, not a schema-validation failure caught before the write was
// attempted.
const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

function isDuplicateEmailError(err) {
  return (
    err &&
    err.code === MONGO_DUPLICATE_KEY_ERROR_CODE &&
    err.keyPattern &&
    Object.prototype.hasOwnProperty.call(err.keyPattern, "email")
  );
}

/**
 * Constructs an (unsaved) Session and signs both tokens for a user,
 * WITHOUT persisting anything. Split out from `issueTokenPair` so
 * `register()` can sign tokens (and therefore discover a signing
 * failure) before it persists the new User at all — see `register()`'s
 * own comment for why that ordering matters specifically for
 * registration.
 *
 * @param {import("mongoose").Types.ObjectId | string} userId
 * @returns {Promise<{ accessToken: string, refreshToken: string, session: import("mongoose").Document }>}
 */
async function prepareTokenPair(userId) {
  // Mongoose assigns `_id` client-side as soon as the document is
  // constructed (before `.save()`), so it's available to embed in the
  // refresh JWT's `sid` claim before the Session is actually persisted.
  const session = new Session({
    userId,
    tokenHash: "pending", // placeholder — overwritten below once the
    // refresh token (and therefore its hash) is known.
    expiresAt: refreshExpiryDate(),
  });

  const refreshToken = signRefreshToken({
    sub: String(userId),
    sid: String(session._id),
  });
  const accessToken = signAccessToken({ sub: String(userId) });
  session.tokenHash = hashRefreshToken(refreshToken);

  return { accessToken, refreshToken, session };
}

/**
 * Issue a fresh access+refresh token pair for a user, signing both
 * tokens and persisting the backing Session. Used by login() and
 * refresh(), where the User already exists (or isn't being written by
 * this call at all), so there's no "avoid persisting before signing
 * succeeds" ordering concern beyond the Session itself — signing still
 * happens first, so a signing failure here persists nothing.
 *
 * @param {import("mongoose").Types.ObjectId | string} userId
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 */
async function issueTokenPair(userId) {
  const { accessToken, refreshToken, session } = await prepareTokenPair(userId);
  await session.save();
  return { accessToken, refreshToken };
}

// Mirrors JWT_REFRESH_EXPIRES's lifetime so Session.expiresAt stays in
// sync with the refresh token's own actual expiry, per the
// implementation plan's Phase B note ("kept in sync by the service
// layer at creation/rotation time — not derived redundantly from the
// JWT itself"). Supports the same duration-string forms
// jsonwebtoken/JWT_REFRESH_EXPIRES already uses in this project
// (`server/README.md`'s existing "7d" example) via a minimal parser
// covering the forms actually used in this codebase, rather than
// pulling in a date-math dependency for one conversion.
function refreshExpiryDate() {
  const raw = process.env.JWT_REFRESH_EXPIRES || "7d";
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) {
    throw new Error(
      `JWT_REFRESH_EXPIRES has an unrecognized format: "${raw}". ` +
        'Expected a number followed by s/m/h/d, e.g. "7d".'
    );
  }
  const [, amountStr, unit] = match;
  const amount = Number(amountStr);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return new Date(Date.now() + amount * unitMs);
}

/**
 * register(payload)
 *
 * payload: { name, email, password }
 *
 * Creates a User with a hashed password (role always defaults to
 * "USER" via the schema — never accepted from the payload, the same
 * way createIssue() never accepts `status`), then immediately issues a
 * token pair (auto-login on register).
 *
 * Duplicate email is handled at two layers, deliberately (defense in
 * depth, matching User's own existing unique-index pattern):
 * 1. A fast pre-check (`findOne`) for a friendly, quick rejection in
 *    the common case.
 * 2. The actual create() call is still wrapped — if two concurrent
 *    registrations race past the pre-check with the same email, the
 *    database's unique index is the real backstop, and its raw
 *    duplicate-key error (E11000) is translated into the same
 *    EMAIL_ALREADY_REGISTERED DomainError as the pre-check path, not
 *    left as a raw Mongo error or misreported as VALIDATION_FAILED.
 */
export async function register(payload) {
  const { name, email, password } = payload;

  const existing = await User.findOne({ email });
  if (existing) {
    throw emailAlreadyRegistered(
      `An account with email "${email}" already exists`
    );
  }

  const passwordHash = await hashPassword(password);
  const user = new User({ name, email, passwordHash }); // unsaved — _id
  // is already available client-side for signing below.

  // Review-pass correction: tokens are signed (via prepareTokenPair)
  // BEFORE the User is persisted at all. The original implementation
  // called User.create() first, then signed tokens afterward — a
  // signing failure (e.g. a missing/misconfigured JWT_ACCESS_SECRET)
  // would then leave a User already written to the database with no
  // usable credentials ever returned to the caller, and every retry
  // would be blocked by the duplicate-email check while hitting the
  // identical signing failure again — a permanently stuck account.
  // Signing first means a signing failure here writes nothing to the
  // database at all.
  const { accessToken, refreshToken, session } = await prepareTokenPair(
    user._id
  );

  try {
    await user.save();
  } catch (err) {
    if (isDuplicateEmailError(err)) {
      // Lost the race between the pre-check above and this write: the
      // unique index is the real enforcement mechanism, this is just
      // making sure its failure mode reports the same DomainError the
      // fast-path pre-check above would have.
      throw emailAlreadyRegistered(
        `An account with email "${email}" already exists`
      );
    }
    throw wrapMongooseValidationError(err);
  }

  // Narrow residual window, deliberately accepted without a
  // transaction — consistent with this project's existing no-
  // transactions reasoning for refresh()'s analogous case (Phase C):
  // if the User save above succeeds but this Session save fails (e.g.
  // a rare transient DB error between two consecutive writes), the
  // account exists correctly and the user can simply log in to receive
  // working credentials. This is not a stuck state, unlike the
  // signing-failure case avoided above.
  await session.save();

  return {
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
    accessToken,
    refreshToken,
  };
}

/**
 * login(payload)
 *
 * payload: { email, password }
 *
 * Deliberately returns the identical INVALID_CREDENTIALS error and
 * message whether the email doesn't exist or the password is wrong —
 * the response must never disclose which one occurred (locked security
 * posture, decision-register.md L3 / implementation-plan Phase I).
 */
export async function login(payload) {
  const { email, password } = payload;

  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user) {
    throw invalidCredentials("Invalid email or password");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw invalidCredentials("Invalid email or password");
  }

  const { accessToken, refreshToken } = await issueTokenPair(user._id);

  return {
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
    accessToken,
    refreshToken,
  };
}

/**
 * refresh(rawRefreshToken)
 *
 * Rotates a refresh token: atomically consumes the old Session and
 * issues a new one. Per the corrected implementation plan (Phase C),
 * this uses a SINGLE atomic `findOneAndDelete` with a compound filter
 * (`_id`, `userId`, `tokenHash`, `expiresAt: { $gt: now }`) rather than
 * a separate read followed by a separate delete — the two-step version
 * was rejected because it opens a failure window where the old session
 * could be deleted before the replacement is successfully created for
 * unrelated reasons (e.g. a transient DB error), losing the user's
 * session for no concurrency-related reason.
 *
 * The single-use guarantee (L14a, locked): under two simultaneous
 * refresh calls with the same token, MongoDB's atomicity on
 * findOneAndDelete guarantees only one of them observes a non-null
 * result — reusing the same class of guarantee issue.service.js's
 * conditional findOneAndUpdate already relies on, not a newly-invented
 * concurrency strategy.
 *
 * One consequence, deliberate and documented in the plan: this single
 * compound-filter delete cannot distinguish "expired" from "wrong
 * user" from "already consumed by a concurrent request" — all three
 * collapse to the same `null` result and the same REFRESH_FAILED error
 * with a generic message. A more specific error would require a
 * second, non-atomic diagnostic read that this project has explicitly
 * declined to add.
 */
export async function refresh(rawRefreshToken) {
  let decoded;
  try {
    decoded = verifyRefreshToken(rawRefreshToken);
  } catch {
    // Malformed, tampered, or expired refresh JWT — same generic
    // failure as every other refresh rejection reason (see header
    // comment).
    throw refreshFailed("Refresh failed");
  }

  const { sub, sid } = decoded;
  const tokenHash = hashRefreshToken(rawRefreshToken);

  let consumed;
  try {
    consumed = await Session.findOneAndDelete({
      _id: sid,
      userId: sub,
      tokenHash,
      expiresAt: { $gt: new Date() }, // independent expiry check (L13) —
      // expressed as a query condition, not a separate read. TTL index
      // cleanup on the Session model is eventual-only and must never be
      // relied on here.
    });
  } catch {
    // A malformed `sid` (not a valid ObjectId) throws a Mongoose
    // CastError here — still just a refresh failure from the caller's
    // perspective, not a distinct error category.
    throw refreshFailed("Refresh failed");
  }

  if (!consumed) {
    // Session not found, wrong user, expired, or already consumed by a
    // concurrent request — all collapse to the same outcome, per the
    // header comment.
    throw refreshFailed("Refresh failed");
  }

  const { accessToken, refreshToken: newRefreshToken } = await issueTokenPair(sub);

  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * logout(sid)
 *
 * Deletes the current Session, immediately invalidating the refresh
 * token. Per L17 (locked), this does NOT and cannot invalidate an
 * already-issued, unexpired access token — that token is a stateless
 * JWT with no session lookup in its verification path, and this is the
 * accepted, intended trade-off, not a gap to close by adding one.
 *
 * Idempotent by design: deleting an already-deleted or nonexistent
 * session is not an error. Logout should never fail visibly to the
 * client for "there was nothing to log out of."
 *
 * @param {string} sid
 */
export async function logout(sid) {
  if (!sid) {
    return { success: true };
  }
  try {
    await Session.deleteOne({ _id: sid });
  } catch {
    // A malformed sid (not a valid ObjectId) throws a CastError here —
    // logout's idempotent contract means this is still a no-op success
    // from the caller's perspective, not an error to surface.
  }
  return { success: true };
}
