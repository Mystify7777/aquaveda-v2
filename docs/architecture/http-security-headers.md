# HTTP security headers baseline (#129)

Status: implemented for application-owned responses. **Hosting-layer behavior is unverified** (see "Deployment-owned").

## Current state before this change (verified on `main` @ 792642d)
- Next.js: `next.config.ts` empty, no `proxy.ts`/`middleware.ts` => no security headers; default `X-Powered-By: Next.js`.
- Express: no header middleware (`helmet` not a dependency); default `X-Powered-By: Express`.
- No hosting config in the repo (no `vercel.json`, `render.yaml`, Dockerfile). Docs only say the web app is "e.g. Vercel" and the API a container PaaS ("e.g. Render, Railway, Fly.io").

## Ownership
| Header | Web (Next, `next.config.ts` `headers()`) | API (Express, first middleware) | Notes |
|---|---|---|---|
| `X-Content-Type-Options` | `nosniff` | `nosniff` | App-owned |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `no-referrer` | See rationale |
| `X-Frame-Options` | `DENY` | `DENY` | App-owned; no embedding use exists (no iframe/embed in `src`) |
| `Permissions-Policy` | deny list, `geolocation=(self)` | deny list incl. `geolocation=()` | App-owned |
| `X-Powered-By` | removed (`poweredByHeader:false`) | removed (`app.disable`) | App-owned |
| `Strict-Transport-Security` | **not set** | **not set** | Hosting-owned |
| `Content-Security-Policy` | **not set** | **not set** | Deferred decision |

Single source of truth: web `src/lib/security-headers.ts` (consumed by `next.config.ts`); API `server/src/middleware/security-headers.js`. The two surfaces are different origins, so no response is covered by both layers (no duplicate/contradictory policy).

## Rationale
- **Web `Referrer-Policy` must not be `no-referrer`/`same-origin`.** Explore tiles load from `tile.openstreetmap.org`; OSM's wiki ("Referer", "Blocked tiles") states tile requests without a Referer are blocked (403 "Referer is required") and lists the acceptable policies, including `strict-origin-when-cross-origin`. It is also the modern browser default, so behavior is unchanged while being made explicit.
- **API `no-referrer`**: JSON responses have no page context; nothing legitimate depends on it. (CSRF provenance checks read the request's `Origin`/`Referer`, which are unaffected by the response header.)
- **`X-Frame-Options: DENY`**: no verified embedding requirement. If embedding is ever needed, introduce it deliberately (CSP `frame-ancestors`).
- **Permissions-Policy**: only capabilities AquaVeda uses stay on: `geolocation=(self)` (report form "Use my current location"). Clipboard writes (copy Issue ID) are not listed (default allowlist is `self`). Unused powerful features are disabled. Unrecognized feature names are ignored by browsers.
- **`X-Powered-By` removed**: pure information disclosure.
- **Middleware order (API)**: first, so CORS preflights, CSRF-guard 403s, body-parser 400s, 404s and the error handler all carry the headers. The middleware only sets response headers; CORS, cookies, CSRF, auth and response envelopes are untouched.
- **No `helmet`**: its defaults include CSP, HSTS, CORP/COOP, which would each need to be disabled or analyzed; four static headers are clearer and add no dependency (dependency policy). Revisit if the header set grows.

## Deployment-owned (NOT guaranteed by this change)
- **HSTS** belongs at the HTTPS-terminating boundary. The API does not configure `trust proxy` and cannot know the public scheme; `includeSubDomains`/`preload` scope is a domain-wide decision. Verify what the chosen hosts add with `curl -sI https://<host>`; set at the host/CDN if absent.
- **Static assets/CDN**: the web headers were verified against `next start` (pages, route handler, 404, `/_next/static/*`, favicon). Whether the production host's CDN serves static files with these headers, and does not override them, must be confirmed on the deployed URL.
- **Platform headers** (Vercel/Render/proxies) may add or override headers; none were observed or assumed. Production smoke-test checklist:
  1. `curl -sI https://<web>/`, `/explore`, `/_next/static/<chunk>`, a 404 path: expect the four web headers, no `X-Powered-By`.
  2. `curl -sI https://<api>/api/v1/health` and a 404/401 path: expect the four API headers, no `X-Powered-By`.
  3. Check for duplicated or conflicting values added by the platform; confirm HSTS present on both.
  4. Load Explore in a browser: tiles render, "Use my current location" prompts, copy-ID works.

## CSP (separate hardening decision — not implemented)
Findings to account for before writing a policy:
- Next.js App Router emits inline bootstrap/hydration scripts (needs nonces via a proxy, or `'unsafe-inline'`); `next-themes` injects an inline script.
- Leaflet injects inline styles; `img-src` needs `https://tile.openstreetmap.org` (+ `data:` if marker icons are inlined).
- `connect-src` must allow the cross-origin API origin (credentialed fetch); fonts are self-hosted by `next/font` at build time.
- Needs a report-only rollout and browser testing of Explore/Learn/Act/auth flows before enforcement.
