/**
 * Baseline HTTP security headers for the Next.js web surface (Issue #129).
 *
 * Applied once, by `next.config.ts` `headers()`, to every path the Next
 * server answers (pages, route handlers, static assets, 404s). The Express
 * API owns its own, separate set (server/src/middleware/security-headers.js);
 * the two surfaces are different origins and different response types, so
 * their values intentionally differ. See
 * docs/architecture/http-security-headers.md for ownership and rationale.
 *
 * Deliberately NOT set here:
 *  - Content-Security-Policy: separate compatibility decision (inline
 *    bootstrap/theme scripts, Leaflet styles/tiles, cross-origin API).
 *  - Strict-Transport-Security: belongs to the HTTPS-terminating hosting
 *    boundary, not to an app that cannot see the public scheme.
 */

export interface HeaderEntry {
  key: string;
  value: string;
}

/**
 * strict-origin-when-cross-origin (the modern browser default, made
 * explicit): full URL only same-origin, origin only cross-origin, nothing on
 * downgrade. Must NOT be `no-referrer` or `same-origin`: OpenStreetMap's tile
 * servers (used by the Explore map) reject tile requests that carry no
 * Referer (HTTP 403 "Referer is required").
 */
export const WEB_REFERRER_POLICY = "strict-origin-when-cross-origin";

/**
 * Capabilities AquaVeda does not use are disabled; `geolocation=(self)` stays
 * because the report form's "Use my current location" calls
 * `navigator.geolocation`. Clipboard writes (copy Issue ID) are not listed:
 * their default allowlist is already 'self'.
 */
export const WEB_PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "display-capture=()",
  "geolocation=(self)",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "serial=()",
  "usb=()",
].join(", ");

export const WEB_SECURITY_HEADERS: readonly HeaderEntry[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: WEB_REFERRER_POLICY },
  // No legitimate embedding use exists (verified: no iframe/embed in src).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: WEB_PERMISSIONS_POLICY },
];
