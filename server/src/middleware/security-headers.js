/**
 * Baseline HTTP security headers for the Express API (Issue #129).
 *
 * Mounted FIRST in createApp(), before body parsing, CORS, the CSRF guard
 * and routing, so that every response the API produces carries them: normal
 * responses, CORS preflights, 4xx/5xx from the CSRF guard and body parser,
 * 404s and the centralized error handler.
 *
 * Scope: static, response-only headers. This middleware never reads the
 * request and never touches CORS, cookies, CSRF or authorization. The web
 * surface (Next.js) owns its own set in src/lib/security-headers.ts; values
 * differ on purpose because the API only returns JSON and is never rendered
 * or embedded.
 *
 * Deliberately NOT set here:
 *  - Strict-Transport-Security: owned by the HTTPS-terminating hosting
 *    boundary. This app does not configure `trust proxy`, so it cannot know
 *    the public scheme, and HSTS scope (includeSubDomains/preload) is a
 *    deployment decision.
 *  - Content-Security-Policy: not meaningful for JSON-only responses beyond
 *    what these headers already cover; web CSP is a separate decision.
 *  - Cross-Origin-Resource-Policy / Cross-Origin-Opener-Policy: would
 *    interact with the credentialed cross-origin (CORS) topology; out of
 *    scope for the baseline.
 */

export const API_SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  // JSON API: no page context, so never leak a referring URL from it.
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  // The API renders nothing; deny every capability the web surface denies
  // (including geolocation, which only the web app's own pages use).
  "Permissions-Policy": [
    "accelerometer=()",
    "camera=()",
    "display-capture=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "microphone=()",
    "midi=()",
    "payment=()",
    "serial=()",
    "usb=()",
  ].join(", "),
});

export function securityHeaders(req, res, next) {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  next();
}

export default securityHeaders;
