import { Router } from "express";

import { register, login, refresh, logout } from "../services/auth.service.js";
import { DomainErrorCode } from "../services/errors.js";
import {
  getAccessTokenLifetimeMs,
  getRefreshTokenLifetimeMs,
} from "../services/auth-tokens.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../middleware/auth.js";
import { registerSchema, loginSchema } from "../validation/auth.validation.js";

/**
 * Authentication routes — the five-endpoint minimal auth API surface
 * locked in decision-register.md (L4) and detailed in
 * authentication-implementation-plan.md Phase F.
 *
 * This router is deliberately self-contained: it never imports or
 * calls issue.service.js, knowledge.service.js, comment.service.js, or
 * project.service.js. That is the concrete, checkable form of the
 * scope-boundary test locked as L5 — reviewable by inspecting this
 * file's own import list, not just asserted in prose.
 *
 * Kept thin on purpose: HTTP request → auth.service.js → HTTP response.
 * No JWT verification happens here (that's auth-tokens.js, called only
 * from auth.service.js and the auth middleware). No actor resolution
 * happens here (that's authMiddleware, mounted globally in app.js) —
 * `/me` simply reads `req.actorContext`, already populated before this
 * router ever runs.
 *
 * Request-shape validation (Phase G) is applied only to `/register` and
 * `/login`, through their local Zod schemas in `auth.validation.js`.
 * The successfully-parsed output (`parsed.data`, not raw `req.body`) is
 * what reaches `auth.service.js` — this is what actually delivers Zod's
 * email canonicalization forward, not merely validates shape.
 * `/refresh`, `/logout`, and `/me` are cookie/context-driven and
 * deliberately have no request-body schema.
 */

export const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";

// Refresh cookie is scoped to the auth API namespace (/api/v1/auth —
// every route this router defines: register, login, logout, me,
// refresh), rather than sent on every request like the access cookie.
// It is not scoped only to the two routes that actually read it
// (refresh, logout) — Express cookie paths are prefix-based, not a
// per-route allowlist, so the narrowest correct prefix covering both
// consumers is the shared router mount point itself. Still meaningfully
// narrower than "/", which is the actual hardening this achieves: the
// browser never attaches this cookie to any non-auth request.
const REFRESH_COOKIE_PATH = "/api/v1/auth";

/**
 * Cookie attributes shared by both auth cookies, split explicitly
 * between what's locked and what's still deployment-dependent
 * (decision-register.md L2a):
 * - `httpOnly: true` and `secure` (true in production) are locked
 *   outright, not configurable.
 * - `sameSite` and `domain` are genuinely deployment-dependent — read
 *   from env vars with a safe default, never guessed merely because
 *   Topology B separates the frontend/backend deployments. Separate
 *   deployment is not the same fact as cross-site; that distinction is
 *   about registrable domains, which aren't known until real hosting
 *   targets are chosen (see COOKIE_SAME_SITE's default below).
 */
function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Defaults to "lax", the more restrictive/simpler choice, correct
    // for sibling-subdomain deployments. Only a genuinely cross-site
    // deployment (different registrable domains) needs "none" — that
    // requires `secure: true` regardless, which is already forced above
    // in production. Not guessed automatically from Topology B alone.
    sameSite: process.env.COOKIE_SAME_SITE || "lax",
    // Unset (undefined) defaults to the request's own host — only set
    // this once real hosting targets require cross-subdomain sharing.
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, {
    ...baseCookieOptions(),
    path: "/",
    maxAge: getAccessTokenLifetimeMs(),
  });
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    ...baseCookieOptions(),
    path: REFRESH_COOKIE_PATH,
    maxAge: getRefreshTokenLifetimeMs(),
  });
}

function clearAuthCookies(res) {
  // clearCookie must be called with the SAME path/domain/sameSite the
  // cookie was originally set with, or the browser will not recognize
  // it as the same cookie and won't actually clear it. maxAge is
  // irrelevant to clearing and intentionally omitted.
  res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, { ...baseCookieOptions(), path: "/" });
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    ...baseCookieOptions(),
    path: REFRESH_COOKIE_PATH,
  });
}

/**
 * Local, auth-route-specific error → HTTP status mapping. Deliberately
 * NOT a generic/global error-handling module — that decision belongs to
 * a future Routes milestone with its own review, not to this
 * self-contained router. `AUTHORIZATION_POLICY_UNRESOLVED` is
 * intentionally absent: it's an Issue-lifecycle concern
 * (issue.service.js), unrelated to anything this router touches, and
 * D-3a stays untouched here as everywhere else in this milestone.
 */
const ERROR_STATUS_MAP = {
  [DomainErrorCode.VALIDATION_FAILED]: 400,
  [DomainErrorCode.UNAUTHORIZED]: 401,
  [DomainErrorCode.INVALID_CREDENTIALS]: 401,
  [DomainErrorCode.EMAIL_ALREADY_REGISTERED]: 409,
  [DomainErrorCode.REFRESH_FAILED]: 401,
  [DomainErrorCode.NOT_FOUND]: 404,
};

/**
 * Review-pass correction: only errors with a KNOWN, mapped
 * DomainErrorCode get their message forwarded to the client — those
 * messages are intentionally written to be client-safe (e.g.
 * "Invalid email or password"). Anything else (an unmapped
 * DomainErrorCode, a raw Mongoose/driver error, a bug) is NOT a
 * message this router wrote for public consumption — it could contain
 * internal details (a Mongo connection string fragment, a stack-trace
 * fragment, a library-specific message) that must never reach a
 * client. Unknown errors are logged server-side in full and always
 * get the same generic 500 body, never their own `.message`.
 *
 * This is a narrow, auth-router-local fix — not a generic/global
 * error-handling module. A future Routes milestone may want a shared
 * version of this same principle; that's a separate decision.
 */
function sendDomainError(res, err) {
  const status = ERROR_STATUS_MAP[err?.code];

  if (status !== undefined) {
    res.status(status).json({
      success: false,
      code: err.code,
      message: err.message,
    });
    return;
  }

  // Unmapped/unknown error: log the real thing server-side, never
  // forward it to the client.
  console.error("[auth.routes] Unexpected error:", err);
  res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  });
}

/**
 * Zod validation-failure translator (Phase G), kept local to this
 * router — not a generic/global validation middleware, per the same
 * scope discipline as `sendDomainError`. Only `/register` and `/login`
 * use this; `/refresh`, `/logout`, and `/me` have no request-body shape
 * to validate (cookie/context-driven), so no schema exists for them.
 *
 * Response shape matches `sendDomainError`'s exactly
 * (`{ success, code, message }`), even though this isn't a thrown
 * `DomainError` — consistency for API consumers, not a coincidence.
 */
function sendValidationError(res, zodError) {
  res.status(400).json({
    success: false,
    code: DomainErrorCode.VALIDATION_FAILED,
    message: zodError.issues[0]?.message || "Invalid request body",
  });
}

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    // parsed.data, not req.body — this is what actually carries the
    // Zod-canonicalized (trimmed, lowercased) email forward. The
    // service ALSO canonicalizes independently (see auth.service.js's
    // canonicalizeEmail) for callers that bypass this route entirely.
    const { user, accessToken, refreshToken } = await register(parsed.data);
    setAuthCookies(res, { accessToken, refreshToken });
    res.status(201).json({ success: true, user });
  } catch (err) {
    sendDomainError(res, err);
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const { user, accessToken, refreshToken } = await login(parsed.data);
    setAuthCookies(res, { accessToken, refreshToken });
    res.status(200).json({ success: true, user });
  } catch (err) {
    sendDomainError(res, err);
  }
});

authRouter.post("/logout", async (req, res) => {
  // logout() is idempotent by design and never throws for a
  // missing/malformed/expired token (see its own header comment) — no
  // try/catch is needed here, unlike the other four routes.
  await logout(req.cookies?.[REFRESH_TOKEN_COOKIE_NAME]);
  clearAuthCookies(res);
  res.status(200).json({ success: true });
});

authRouter.get("/me", (req, res) => {
  // No service call, no try/catch: req.actorContext was already
  // resolved by the globally-mounted authMiddleware before this handler
  // ever runs. This route's entire job is reading that value — per the
  // Phase E correction, there is no second, parallel actor-resolution
  // path anywhere in this codebase.
  res.status(200).json({ success: true, user: req.actorContext });
});

authRouter.post("/refresh", async (req, res) => {
  try {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    const { user, accessToken, refreshToken } = await refresh(rawRefreshToken);
    setAuthCookies(res, { accessToken, refreshToken });
    res.status(200).json({ success: true, user });
  } catch (err) {
    // A failed refresh also clears cookies — an unusable refresh token
    // shouldn't keep being resent on every subsequent request.
    clearAuthCookies(res);
    sendDomainError(res, err);
  }
});

export default authRouter;
