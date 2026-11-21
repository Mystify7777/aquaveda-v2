import { createHash, randomBytes } from "node:crypto";
import { User } from "../models/User.js";
import { ACCOUNT_STATES } from "../domain/account-state.js";
import { isRestrictionExpired } from "../domain/account-restriction.js";
import { expireSuspensionIfDue, purgeStaleSessions } from "./account-governance.service.js";
import { Session } from "../models/Session.js";
import { PasswordResetCredential } from "../models/PasswordResetCredential.js";
import { sendPasswordResetEmail } from "./password-reset-email.js";
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
  getRefreshTokenLifetimeMs,
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

/**
 * Canonicalizes an email the same way for every caller of this service,
 * regardless of whether they came through Zod-validated HTTP routes or
 * called register()/login() directly (as every test in this project
 * does). auth.validation.js's Zod schemas ALSO canonicalize — that is
 * deliberate defense-in-depth, not redundant duplication: a normalization
 * rule that only lived in Zod would leave every direct service caller
 * with the case-sensitivity bug this function exists to close (found
 * during Phase G — see decision-register.md). Kept local to this file,
 * not extracted into a shared module, since nothing else in this
 * project currently needs it.
 *
 * @param {string} email
 * @returns {string}
 */
function canonicalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : email;
}

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
async function prepareTokenPair(userId, gen = 0) {
  // Mongoose assigns `_id` client-side as soon as the document is
  // constructed (before `.save()`), so it's available to embed in the
  // refresh JWT's `sid` claim before the Session is actually persisted.
  const session = new Session({
    userId,
    tokenHash: "pending", // placeholder — overwritten below once the
    // refresh token (and therefore its hash) is known.
    expiresAt: refreshExpiryDate(),
    // Bind the session to the credential generation it is issued under.
    // Absent = 0 (no migration for existing records or users).
    ...(gen > 0 ? { authGeneration: gen } : {}),
  });

  const refreshToken = signRefreshToken({
    sub: String(userId),
    sid: String(session._id),
  });
  const accessToken = signAccessToken({ sub: String(userId), gen });
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
async function issueTokenPair(userId, gen = 0) {
  const { accessToken, refreshToken, session } = await prepareTokenPair(userId, gen);
  await session.save();
  return { accessToken, refreshToken };
}

// Mirrors JWT_REFRESH_EXPIRES's lifetime so Session.expiresAt stays in
// sync with the refresh token's own actual expiry, per the
// implementation plan's Phase B note ("kept in sync by the service
// layer at creation/rotation time — not derived redundantly from the
// JWT itself"). Phase F review correction: this now calls the single
// shared duration parser in auth-tokens.js (`getRefreshTokenLifetimeMs`)
// instead of maintaining its own independent regex — see that
// function's own comment for why having two parsers for the same env
// var was a real drift risk, not just a style nit.
function refreshExpiryDate() {
  return new Date(Date.now() + getRefreshTokenLifetimeMs());
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
  const { name, password } = payload;
  const email = canonicalizeEmail(payload.email);

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
  const { password } = payload;
  const email = canonicalizeEmail(payload.email);

  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user) {
    throw invalidCredentials("Invalid email or password");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw invalidCredentials("Invalid email or password");
  }

  // Account state is checked after credential verification so the login
  // path never becomes an account-enumeration oracle. MUTED remains
  // login/read-capable; blocked lifecycle states cannot establish a new
  // authenticated session.
  let accountState = user.accountState ?? ACCOUNT_STATES.ACTIVE;
  let credentialGeneration = user.authGeneration ?? 0;

  // A TEMPORARY suspension whose expiry has passed must not keep the account
  // locked out (#207): persist the lift (idempotent, SYSTEM event), then
  // re-read. Any failure leaves the account suspended (fail closed). An
  // INDEFINITE suspension never matches.
  if (
    accountState === ACCOUNT_STATES.HARD_SUSPENDED &&
    isRestrictionExpired(user.accountRestriction)
  ) {
    try {
      await expireSuspensionIfDue(user._id);
      // Re-read BOTH: the lift bumps the credential generation, and the token
      // issued below must carry the NEW one or it would be rejected.
      const fresh = await User.findById(user._id).select("accountState authGeneration");
      accountState = fresh?.accountState ?? ACCOUNT_STATES.ACTIVE;
      credentialGeneration = fresh?.authGeneration ?? 0;
    } catch (err) {
      console.error("[auth] failed to persist suspension expiry at login", { name: err?.name });
    }
  }

  if (accountState === ACCOUNT_STATES.HARD_SUSPENDED) {
    throw new DomainError(
      DomainErrorCode.ACCOUNT_SUSPENDED,
      "Account access is suspended",
    );
  }
  if (accountState === ACCOUNT_STATES.DELETION_PENDING) {
    throw new DomainError(
      DomainErrorCode.ACCOUNT_DELETION_PENDING,
      "Account deletion is pending",
    );
  }
  if (accountState === ACCOUNT_STATES.PERMANENTLY_DELETED) {
    throw new DomainError(
      DomainErrorCode.ACCOUNT_PERMANENTLY_DELETED,
      "Account is permanently deleted",
    );
  }

  // The access token carries the user's CURRENT credential generation, so a
  // login after a suspension lift gets a token the server accepts, while any
  // token issued before the lift stays invalid (#207).
  const { accessToken, refreshToken } = await issueTokenPair(user._id, credentialGeneration);

  // Reconcile: sessions older than the current generation are already unusable
  // (refresh rejects them); remove any a crashed or failed cleanup left behind.
  // Idempotent and best-effort; never affects the login.
  if (credentialGeneration > 0) {
    try {
      await purgeStaleSessions(user._id);
    } catch (err) {
      console.error("[auth] stale session reconciliation failed", { name: err?.name });
    }
  }

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
 *
 * Phase F review correction: now also resolves and returns the User,
 * matching register()/login()'s response shape exactly — the route
 * layer needs `{ user }` in its response body, and the only source of
 * that data is a DB read (nothing earlier in this function's flow ever
 * had the full User document in memory, only its id). This is one
 * additional `findById`, not a duplicate of anything already done.
 */
export async function refresh(rawRefreshToken) {
  let decoded;
  try {
    decoded = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw refreshFailed("Refresh failed");
  }

  const { sub, sid } = decoded;
  const tokenHash = hashRefreshToken(rawRefreshToken);

  // Consume the presented session atomically before doing any further
  // work. All outcomes for absent/expired/consumed sessions stay generic.
  let consumed;
  try {
    consumed = await Session.findOneAndDelete({
      _id: sid,
      userId: sub,
      tokenHash,
      expiresAt: { $gt: new Date() },
    });
  } catch {
    throw refreshFailed("Refresh failed");
  }
  if (!consumed) throw refreshFailed("Refresh failed");

  const user = await User.findById(sub);
  if (!user) {
    await Session.deleteMany({ userId: sub });
    throw refreshFailed("Refresh failed");
  }

  const state = user.accountState ?? ACCOUNT_STATES.ACTIVE;
  const rejectBlockedState = async (currentState) => {
    await Session.deleteMany({ userId: sub });
    if (currentState === ACCOUNT_STATES.HARD_SUSPENDED) {
      throw new DomainError(DomainErrorCode.ACCOUNT_SUSPENDED, "Account access is suspended");
    }
    if (currentState === ACCOUNT_STATES.DELETION_PENDING) {
      throw new DomainError(DomainErrorCode.ACCOUNT_DELETION_PENDING, "Account deletion is pending");
    }
    if (currentState === ACCOUNT_STATES.PERMANENTLY_DELETED) {
      throw new DomainError(DomainErrorCode.ACCOUNT_PERMANENTLY_DELETED, "Account is permanently deleted");
    }
    throw refreshFailed("Refresh failed");
  };

  if (state !== ACCOUNT_STATES.ACTIVE && state !== ACCOUNT_STATES.MUTED) {
    await rejectBlockedState(state);
  }

  // Re-read account state immediately before token issuance. This catches
  // a state transition that committed after the previous read.
  const latestUser = await User.findById(sub);
  if (!latestUser) {
    await Session.deleteMany({ userId: sub });
    throw refreshFailed("Refresh failed");
  }
  const latestState = latestUser.accountState ?? ACCOUNT_STATES.ACTIVE;
  if (latestState !== ACCOUNT_STATES.ACTIVE && latestState !== ACCOUNT_STATES.MUTED) {
    await rejectBlockedState(latestState);
  }

  // The presented session must belong to the user's CURRENT credential
  // generation (#217/#219). A restoration bumps the generation in the same
  // write that restores eligibility, so a pre-suspension session is rejected
  // here even if no cleanup ever ran (crash-safe). The check uses the same
  // snapshot (state + version) the reservation below is pinned to.
  if ((consumed.authGeneration ?? 0) !== (latestUser.authGeneration ?? 0)) {
    throw refreshFailed("Refresh failed");
  }

  // Atomic state/version reservation coordinates refresh issuance with
  // governance transitions. Every transition that changes accountState
  // must increment accountStateVersion in the same User update.
  const version = latestUser.accountStateVersion ?? 0;
  const reservation = await User.findOneAndUpdate(
    {
      _id: latestUser._id,
      accountState: { $in: [ACCOUNT_STATES.ACTIVE, ACCOUNT_STATES.MUTED] },
      accountStateVersion: version,
    },
    { $inc: { accountStateVersion: 1 } },
    { new: true },
  );
  if (!reservation) {
    const current = await User.findById(sub).select("accountState");
    if (!current) {
      await Session.deleteMany({ userId: sub });
      throw refreshFailed("Refresh failed");
    }
    await rejectBlockedState(current.accountState ?? ACCOUNT_STATES.ACTIVE);
    throw refreshFailed("Refresh failed");
  }

  const { accessToken, refreshToken: newRefreshToken } = await issueTokenPair(sub, reservation.authGeneration ?? 0);
  return {
    user: {
      id: reservation._id,
      name: reservation.name,
      email: reservation.email,
      role: reservation.role,
    },
    accessToken,
    refreshToken: newRefreshToken,
  };
}

/**
 * logout(rawRefreshToken)
 *
 * Deletes the current Session, immediately invalidating the refresh
 * token. Per L17 (locked), this does NOT and cannot invalidate an
 * already-issued, unexpired access token — that token is a stateless
 * JWT with no session lookup in its verification path, and this is the
 * accepted, intended trade-off, not a gap to close by adding one.
 *
 * Phase F review correction: accepts the RAW refresh token (what a
 * route actually has, straight from the refresh cookie), not a bare
 * `sid`. Extracting `sid` requires verifying the refresh JWT — a
 * token-layer concern — and doing that in the route itself would leak
 * JWT-handling into the routing layer, breaking the "routes are thin,
 * HTTP-only" boundary this project has kept everywhere else. This
 * function is now the one place that decodes the token, exactly like
 * refresh() already does.
 *
 * Idempotent by design, and this must hold for every one of these
 * inputs, not just a genuinely-missing session: no token at all, a
 * malformed token, an expired token, a token whose session was already
 * deleted (e.g. a prior logout, or a refresh that already rotated it
 * away). None of these are errors — logout should never fail visibly
 * to the client for "there was nothing left to log out of." The client
 * clears its cookies regardless of what this function returns.
 *
 * @param {string | undefined | null} rawRefreshToken
 */
export async function logout(rawRefreshToken) {
  if (!rawRefreshToken) {
    return { success: true };
  }

  let sid;
  try {
    ({ sid } = verifyRefreshToken(rawRefreshToken));
  } catch {
    // Malformed, tampered, or expired refresh JWT — nothing to look up.
    // Still a successful (no-op) logout, per the idempotent contract
    // above.
    return { success: true };
  }

  try {
    await Session.deleteOne({ _id: sid });
  } catch {
    // A malformed sid inside an otherwise well-formed token (shouldn't
    // happen in practice, since this service is the only issuer of
    // `sid` values, but defended anyway) throws a CastError here —
    // still a no-op success, same reasoning as above.
  }
  return { success: true };
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_RESPONSE_FLOOR_MS = 250;
const PASSWORD_RESET_INVALID_MESSAGE = "This password reset link is invalid or has expired. Request a new link and try again.";

/**
 * Always returns the same result for known and unknown email addresses.
 * The raw credential is only passed to the mail transport and is never
 * persisted or included in a response or log.
 */
export async function requestPasswordReset(emailInput, deliverEmail = sendPasswordResetEmail) {
  const startedAt = Date.now();
  const email = canonicalizeEmail(emailInput);
  const user = await User.findOne({ email });

  if (user) {
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await PasswordResetCredential.deleteMany({ userId: user._id });
    await PasswordResetCredential.create({
      userId: user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    });

    try {
      // Do not make the HTTP response wait on SMTP: delivery latency is
      // outside the requester's control and would distinguish known from
      // unknown addresses. The running API process owns this promise.
      Promise.resolve(deliverEmail(user.email, rawToken)).catch(() => {
        // Deliberately do not log the error object: transport errors can
        // contain message content or other sensitive delivery metadata.
        console.warn("[auth.password-reset] Reset email delivery failed.");
      });
    } catch {
      console.warn("[auth.password-reset] Reset email delivery failed.");
    }
  }

  const remainingDelay = PASSWORD_RESET_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
  if (remainingDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  }

  return { success: true };
}

/** Atomically consumes a valid token, updates the password, and revokes refresh sessions.
 *
 * Account-state policy for password reset:
 *   ACTIVE           — permitted (normal case).
 *   MUTED            — permitted; muting is a contribution restriction, not a credential block.
 *   HARD_SUSPENDED   — REJECTED. The credential reset path must not be a suspension bypass.
 *   DELETION_PENDING — REJECTED. Credential changes are not permitted once deletion is queued.
 *   PERMANENTLY_DELETED — REJECTED. The account no longer exists.
 *
 * The credential is consumed BEFORE the state check so that an attacker
 * probing blocked accounts cannot distinguish state from "invalid token":
 * either way the token is gone and the response is an identical error.
 */
export async function resetPassword({ token, password }) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const credential = await PasswordResetCredential.findOneAndDelete({
    tokenHash,
    expiresAt: { $gt: new Date() },
  });

  if (!credential) {
    throw new DomainError(DomainErrorCode.PASSWORD_RESET_INVALID, PASSWORD_RESET_INVALID_MESSAGE);
  }

  // Enforce account-state policy AFTER consuming the credential so that
  // blocked-state probing returns the same opaque error as an invalid token.
  const user = await User.findById(credential.userId).select("accountState");
  if (!user) {
    throw new DomainError(DomainErrorCode.PASSWORD_RESET_INVALID, PASSWORD_RESET_INVALID_MESSAGE);
  }
  const blockedStates = new Set([
    ACCOUNT_STATES.HARD_SUSPENDED,
    ACCOUNT_STATES.DELETION_PENDING,
    ACCOUNT_STATES.PERMANENTLY_DELETED,
  ]);
  if (blockedStates.has(user.accountState)) {
    throw new DomainError(DomainErrorCode.PASSWORD_RESET_INVALID, PASSWORD_RESET_INVALID_MESSAGE);
  }

  const passwordHash = await hashPassword(password);
  const update = await User.updateOne(
    { _id: credential.userId },
    { $set: { passwordHash } },
  );
  if (update.matchedCount !== 1) {
    throw new DomainError(DomainErrorCode.PASSWORD_RESET_INVALID, PASSWORD_RESET_INVALID_MESSAGE);
  }

  await Session.deleteMany({ userId: credential.userId });
  await PasswordResetCredential.deleteMany({ userId: credential.userId });
  return { success: true };
}
