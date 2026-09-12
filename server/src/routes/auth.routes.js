import { Router } from "express";

import { register, login, refresh, logout } from "../services/auth.service.js";
import {
  getAccessTokenLifetimeMs,
  getRefreshTokenLifetimeMs,
} from "../services/auth-tokens.js";
import { ACCESS_TOKEN_COOKIE_NAME } from "../middleware/auth.js";
import { resolveCookieSameSite, resolveCookieDomain } from "../config/env.js";
import { registerSchema, loginSchema } from "../validation/auth.validation.js";
import { sendSuccess, sendError, sendValidationError } from "../http/respond.js";

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
/**
 * Phase H resolution: this deployment is genuinely cross-site (frontend
 * and backend on different registrable domains, confirmed), so
 * `sameSite` is "none" and `secure` MUST be true unconditionally —
 * `SameSite=None` without `Secure` is rejected outright by browsers,
 * independent of NODE_ENV. The prior prod-only `secure` gate is kept as
 * an additional OR term (not replaced) so a future non-cross-site
 * deployment reusing "lax"/"strict" still gets today's prod-only
 * behavior without touching this function again.
 *
 * resolveCookieSameSite()/resolveCookieDomain() throw at first call if
 * misconfigured — deliberately not caught here, so a bad env var fails
 * loudly (first request, or import-time in tests) rather than shipping
 * a silently-broken cookie.
 */
function baseCookieOptions() {
  const sameSite = resolveCookieSameSite();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
    sameSite,
    // Unset (undefined) is correct for this deployment's topology — see
    // resolveCookieDomain()'s own comment. Only set COOKIE_DOMAIN if a
    // genuine future subdomain-sharing requirement emerges.
    domain: resolveCookieDomain(),
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
 * Error/validation-failure handling (ROUTE-L4/L5/L6, Routes milestone
 * Phase 9): migrated onto the shared sendError/sendValidationError from
 * http/respond.js, replacing what was previously a local, auth-router-
 * only ERROR_STATUS_MAP/sendDomainError/sendValidationError. This is a
 * presentation-layer migration only — the shared utility's mapped
 * codes are a superset of what this router ever threw
 * (VALIDATION_FAILED, UNAUTHORIZED, INVALID_CREDENTIALS,
 * EMAIL_ALREADY_REGISTERED, REFRESH_FAILED, NOT_FOUND all remain
 * mapped identically), so no auth-specific error behavior changes.
 * `AUTHORIZATION_POLICY_UNRESOLVED` being present in the shared map is
 * irrelevant here — this router never throws or receives it; D-3a
 * stays exactly as untouched as it was before this migration.
 */

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
    sendSuccess(res, { user }, "Registered", 201);
  } catch (err) {
    sendError(res, err);
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
    sendSuccess(res, { user }, "Logged in");
  } catch (err) {
    sendError(res, err);
  }
});

authRouter.post("/logout", async (req, res) => {
  // logout() is idempotent by design and never throws for a
  // missing/malformed/expired token (see its own header comment) — no
  // try/catch is needed here, unlike the other four routes.
  await logout(req.cookies?.[REFRESH_TOKEN_COOKIE_NAME]);
  clearAuthCookies(res);
  sendSuccess(res, null, "Logged out");
});

authRouter.get("/me", (req, res) => {
  // No service call, no try/catch: req.actorContext was already
  // resolved by the globally-mounted authMiddleware before this handler
  // ever runs. This route's entire job is reading that value — per the
  // Phase E correction, there is no second, parallel actor-resolution
  // path anywhere in this codebase.
  sendSuccess(res, { user: req.actorContext }, "OK");
});

authRouter.post("/refresh", async (req, res) => {
  try {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    const { user, accessToken, refreshToken } = await refresh(rawRefreshToken);
    setAuthCookies(res, { accessToken, refreshToken });
    sendSuccess(res, { user }, "Refreshed");
  } catch (err) {
    // A failed refresh also clears cookies — an unusable refresh token
    // shouldn't keep being resent on every subsequent request.
    clearAuthCookies(res);
    sendError(res, err);
  }
});

export default authRouter;
