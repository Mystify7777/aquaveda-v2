# Issue #42 — Public Authentication Endpoint Rate Limiting

## Overview

Rate limiting is applied to the three public, unauthenticated authentication
endpoints that accept credentials or security tokens:

| Route                        | Limit       | Window | Rationale                               |
|------------------------------|-------------|--------|-----------------------------------------|
| `POST /api/v1/auth/register` | 5 requests  | 60 s   | Account creation — tighter limit        |
| `POST /api/v1/auth/login`    | 10 requests | 60 s   | Credential verification — moderate load |
| `POST /api/v1/auth/refresh`  | 10 requests | 60 s   | Token rotation — moderate load          |

**Not rate-limited:**
- `GET /api/v1/auth/me` — read-only, no credentials in body, no brute-force vector.
- `POST /api/v1/auth/logout` — idempotent, no credentials in body, no brute-force vector.

---

## Algorithm: Sliding Window Counter

The rate limiter uses a **sliding window counter** algorithm rather than a fixed-window
or token-bucket approach:

1. Each client key (IP address) maps to an array of Unix-epoch-millisecond timestamps.
2. On each request, timestamps older than `windowMs` are pruned.
3. The current timestamp is appended.
4. If the resulting array length exceeds `maxRequests`, the request is rejected.

**Why sliding window?**
- **No burst-at-boundary problem:** Fixed-window counters allow 2× the intended rate
  at the boundary between two consecutive windows (e.g., 10 requests at :59 + 10 at :00
  = 20 requests in 1 second). Sliding window eliminates this.
- **Simpler than token bucket:** Token bucket adds refill-rate complexity that's
  unnecessary for authentication endpoints with straightforward per-minute limits.

---

## Client Identification

Clients are identified **strictly by IP address**, resolved in this order:

1. `X-Forwarded-For` header (first entry — the original client IP behind a proxy chain)
2. `X-Real-IP` header (common single-hop proxy header)
3. `req.socket.remoteAddress` (direct connection, no proxy)

> **⚠ Deployment requirement — trusted reverse proxy:**
> The rate limiter relies on the `X-Forwarded-For` header. This requires the application
> to be deployed behind a trusted reverse proxy that guarantees this header is supplied
> or properly overwritten. It should not be considered universally authoritative in
> untrusted environments.
>
> Without a trusted proxy layer, any client can spoof `X-Forwarded-For` and bypass
> rate limiting entirely by sending an arbitrary IP in that header. Ensure your
> reverse proxy (Nginx, Caddy, Cloudflare, Vercel Edge Network, etc.) strips and
> re-sets this header before forwarding requests to the Express service.

### Security: No Account Enumeration / Lock-out

The rate limiter **NEVER** identifies clients by email, username, or any request-body
field. This is a deliberate security constraint:

- **Account enumeration prevention:** If rate-limiting by email, an attacker can discover
  valid accounts by observing which emails trigger rate limits.
- **Account lock-out prevention:** If rate-limiting by email, an attacker can
  denial-of-service a specific user by spamming login attempts with their email.

IP-based identification is the only identification strategy that avoids both attacks.

---

## Response on Rejection (HTTP 429)

When a request is rate-limited, the middleware returns:

**Status:** `429 Too Many Requests`

**Headers:**
| Header                 | Value                                              |
|------------------------|----------------------------------------------------|
| `Retry-After`          | Seconds until the client can retry                 |
| `X-RateLimit-Limit`    | Maximum requests allowed in the window             |
| `X-RateLimit-Remaining`| Requests remaining (always 0 when rejected)        |
| `X-RateLimit-Reset`    | Unix epoch seconds when the oldest hit expires     |

**Body:** The project's canonical `ApiFailure` envelope:
```json
{
  "success": false,
  "data": null,
  "message": "Too many requests, please try again later",
  "code": "TOO_MANY_REQUESTS"
}
```

The `X-RateLimit-*` headers are also sent on **allowed** requests, enabling
clients to self-throttle before hitting the limit.

---

## Storage

### Current: In-Memory (`Map`)

The default store is a JavaScript `Map` holding per-IP timestamp arrays. This is
correct and sufficient for:

- Single-instance deployments
- Development and staging environments
- Deployments where the Next.js/Express server runs as a single process

A periodic reaper (`setInterval`, 60 s, `unref()`'d) sweeps abandoned entries
to prevent unbounded memory growth.

### Future: Distributed Deployments (Redis / Upstash)

For multi-instance deployments (e.g., Vercel, multiple Kubernetes pods, horizontally
scaled containers), the in-memory store is **not shared across instances** — each
instance maintains its own counter, effectively multiplying the allowed rate by the
number of instances.

The store interface is deliberately minimal:

```javascript
{
  hit(key: string, windowMs: number) → { totalHits: number, resetTime: number },
  reset() → void,
}
```

To switch to Redis/Upstash:
1. Implement a `createRedisStore({ client })` function conforming to this interface.
2. Pass it as the `store` option to `createRateLimiter()`.
3. No other middleware code changes are needed.

Recommended package: [`@upstash/ratelimit`](https://github.com/upstash/ratelimit) or
a direct Redis `MULTI`/`ZRANGEBYSCORE`/`ZADD` implementation using sorted sets for
the sliding window.

---

## File Locations

| File | Purpose |
|------|---------|
| `server/src/middleware/rate-limiter.js` | Core middleware — `createRateLimiter()`, `createInMemoryStore()`, `resolveClientIp()` |
| `server/src/services/errors.js` | `TOO_MANY_REQUESTS` added to `DomainErrorCode` |
| `server/src/http/respond.js` | `TOO_MANY_REQUESTS → 429` added to `ERROR_STATUS_MAP` |
| `server/src/routes/auth.routes.js` | Rate limiters mounted on `/register`, `/login`, `/refresh` |
| `server/tests/rate-limiter.test.js` | Unit tests (no DB dependency) |
| `server/tests/rate-limiter.integration.test.js` | Integration tests (requires MongoDB) |

---

## Privacy & Security Constraints

- **NEVER** log credentials, passwords, or JWT tokens — the rate limiter only tracks
  IP addresses and timestamps.
- **No modifications** to JWT/session business logic, MFA, or CAPTCHA — rate limiting
  is a pure HTTP boundary concern, layered on top of existing auth.
- The rate limiter runs **before** Zod validation and the service layer — a rate-limited
  request never touches business logic.
