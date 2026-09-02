import { Router } from "express";

import { register, login, refresh, logout } from "../services/auth.service.js";
import { DomainErrorCode } from "../services/errors.js";
import {
  getAccessTokenLifetimeMs,
  getRefreshTokenLifetimeMs,
} from "../services/auth-tokens.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../middleware/auth.js";

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
 * No Zod validation yet — that's Phase G. Routes call the service with
 * raw `req.body`; `auth.service.js`'s existing Mongoose-validation-error
 * wrapping provides a reasonable interim fallback.
 */

export const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";

// Refresh cookie is scoped narrowly to the two routes that actually
// read it, rather than sent on every request like the access cookie —
// a small, non-deployment-dependent hardening step the implementation
// plan explicitly said could be locked now (Phase H).
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

function sendDomainError(res, err) {
  const status = ERROR_STATUS_MAP[err?.code] || 500;
  res.status(status).json({
    success: false,
    code: err?.code || "INTERNAL_ERROR",
    message: err?.message || "Internal server error",
  });
}

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  try {
    const { user, accessToken, refreshToken } = await register(req.body ?? {});
    setAuthCookies(res, { accessToken, refreshToken });
    res.status(201).json({ success: true, user });
  } catch (err) {
    sendDomainError(res, err);
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { user, accessToken, refreshToken } = await login(req.body ?? {});
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
