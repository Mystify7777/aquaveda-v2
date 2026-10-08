import { tooManyRequests } from "../services/errors.js";
import { sendError } from "../http/respond.js";

/**
 * Sliding-window rate limiter middleware.
 *
 * Algorithm: for each client key (IP address), an array of request
 * timestamps is stored. On each incoming request, timestamps older than
 * `windowMs` are pruned, and the remaining count is compared against
 * `maxRequests`. If over the limit, the request is rejected with HTTP
 * 429 and the project's canonical ApiFailure envelope (routed through
 * the same sendError pipeline every other error uses — this middleware
 * constructs the DomainError shape directly so respond.js's
 * ERROR_STATUS_MAP handles the HTTP status).
 *
 * Identification: strictly by IP address — `x-forwarded-for` (first
 * entry, for reverse-proxy deployments), then `x-real-ip`, then
 * `req.socket.remoteAddress`. NEVER by email, username, or any
 * request-body field, to prevent account enumeration and account
 * lock-out attacks (Issue #42 security requirement).
 *
 * Storage: in-memory by default via createInMemoryStore(). The store
 * interface ({ hit(key, windowMs) → { totalHits, resetTime } }) is
 * deliberately minimal so a Redis/Upstash implementation can be dropped
 * in for multi-instance Next.js/Express deployments without changing
 * this middleware's logic.
 *
 * @module middleware/rate-limiter
 */

/**
 * Resolves the client IP address from the request, following the
 * standard proxy-header chain. In production behind a reverse proxy
 * (Nginx, Cloudflare, Vercel), `x-forwarded-for` is the authoritative
 * source; `x-real-ip` is a common single-hop alternative; the raw
 * socket address is the last resort (correct for direct connections).
 *
 * @param {import('express').Request} req
 * @returns {string} The resolved client IP address.
 */
export function resolveClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list; the leftmost
    // entry is the original client IP.
    return forwarded.split(",")[0].trim();
  }

  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    return realIp.trim();
  }

  return req.socket?.remoteAddress || "unknown";
}

/**
 * Creates an in-memory sliding-window store.
 *
 * Each key maps to an array of Unix-epoch-millisecond timestamps. On
 * each `hit()` call, expired timestamps (older than `windowMs`) are
 * pruned, the current timestamp is appended, and the result reflects
 * the post-hit state.
 *
 * A periodic reaper (`cleanupIntervalMs`, default 60 s) sweeps all
 * keys to evict fully-expired entries, preventing unbounded growth from
 * clients that hit the limiter once and never return. The interval
 * handle is `unref()`'d so it never keeps a Node.js process alive on
 * its own.
 *
 * @param {{ cleanupIntervalMs?: number }} [options]
 * @returns {{ hit: (key: string, windowMs: number) => { totalHits: number, resetTime: number }, reset: () => void, _store: Map }}
 */
export function createInMemoryStore({ cleanupIntervalMs = 60_000 } = {}) {
  /** @type {Map<string, number[]>} */
  const store = new Map();

  /**
   * Periodic reaper — removes entries whose every timestamp has expired.
   * Does not need to know windowMs at construction time; it prunes
   * entries where the most recent timestamp is older than the largest
   * plausible window (here: any timestamp older than Date.now(), which
   * is always true for expired windows since hit() records
   * Date.now()-relative timestamps).
   *
   * In practice, each key's timestamps are pruned on every hit() call
   * anyway — this reaper only matters for keys that stop receiving
   * traffic entirely.
   */
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of store) {
      // If the newest timestamp is older than now (all timestamps are
      // in the past), no active window can still reference this key.
      // This is conservative — a window could be up to `windowMs` in
      // the future of the newest timestamp — but since hit() prunes
      // per-key on access, this only catches abandoned keys where the
      // precision doesn't matter.
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] < now) {
        store.delete(key);
      }
    }
  }, cleanupIntervalMs);

  // Don't let the reaper keep the process alive (tests, graceful shutdown).
  if (reaper.unref) reaper.unref();

  return {
    /**
     * Records a hit for the given key and returns the current state
     * within the sliding window.
     *
     * @param {string} key - Client identifier (IP address).
     * @param {number} windowMs - Sliding window duration in milliseconds.
     * @returns {{ totalHits: number, resetTime: number }}
     *   - totalHits: number of requests in the current window (including this one).
     *   - resetTime: Unix epoch milliseconds when the oldest request in the
     *     current window expires (i.e., when the client regains one slot).
     */
    hit(key, windowMs) {
      const now = Date.now();
      const windowStart = now - windowMs;

      let timestamps = store.get(key);
      if (!timestamps) {
        timestamps = [];
        store.set(key, timestamps);
      }

      // Prune expired timestamps (everything before windowStart).
      while (timestamps.length > 0 && timestamps[0] <= windowStart) {
        timestamps.shift();
      }

      // Record this request.
      timestamps.push(now);

      return {
        totalHits: timestamps.length,
        // The earliest surviving timestamp + windowMs = when one slot
        // frees up. If the array were somehow empty after the push
        // (impossible), fall back to now + windowMs.
        resetTime: timestamps.length > 0
          ? timestamps[0] + windowMs
          : now + windowMs,
      };
    },

    /**
     * Clears all tracked state. Primarily for testing.
     */
    reset() {
      store.clear();
    },

    /**
     * Exposed for testing/inspection only — not part of the public API
     * contract. Prefixed with underscore to signal this.
     */
    _store: store,
  };
}

// Module-level default store, shared across all rate limiter instances
// that don't provide their own. This means different rate limiters
// (e.g., loginLimiter, registerLimiter) share the same Map, but track
// separate keys because each limiter uses its own windowMs/maxRequests
// — no cross-contamination occurs because the key is the IP address
// and each limiter instance calls hit() independently.
//
// Exported so the auth test suite can call defaultStore.reset() in
// beforeEach to achieve per-test isolation without disabling rate
// limiting or touching production thresholds (PR review requirement).
export const defaultStore = createInMemoryStore();

/**
 * Creates an Express middleware that enforces rate limiting using a
 * sliding-window counter.
 *
 * @param {object} options
 * @param {number} options.windowMs - Time window in milliseconds.
 * @param {number} options.maxRequests - Maximum allowed requests per window.
 * @param {object} [options.store] - Optional store instance (default: shared in-memory store).
 * @param {string} [options.keyPrefix] - Optional prefix for store keys to namespace
 *   different limiters sharing the same store (e.g., "login:", "register:").
 * @returns {import('express').RequestHandler}
 *
 * @example
 * // 10 requests per 60 seconds for the login route
 * const loginLimiter = createRateLimiter({
 *   windowMs: 60_000,
 *   maxRequests: 10,
 *   keyPrefix: "login:",
 * });
 * router.post("/login", loginLimiter, handler);
 */
export function createRateLimiter({
  windowMs,
  maxRequests,
  store = defaultStore,
  keyPrefix = "",
}) {
  return (req, res, next) => {
    const clientIp = resolveClientIp(req);
    const key = `${keyPrefix}${clientIp}`;

    const { totalHits, resetTime } = store.hit(key, windowMs);
    const remaining = Math.max(0, maxRequests - totalHits);
    const resetEpochSeconds = Math.ceil(resetTime / 1000);

    // Always set informational headers, even on allowed requests —
    // lets clients self-throttle before hitting the limit.
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", resetEpochSeconds);

    if (totalHits > maxRequests) {
      const retryAfterSeconds = Math.ceil((resetTime - Date.now()) / 1000);

      res.setHeader("Retry-After", Math.max(1, retryAfterSeconds));

      // Construct the DomainError via tooManyRequests and forward to sendError
      // (where ERROR_STATUS_MAP maps DomainErrorCode.TOO_MANY_REQUESTS -> 429),
      // preserving the canonical {success, data, message, code} failure envelope.
      sendError(res, tooManyRequests("Too many requests, please try again later"));
      return;
    }

    next();
  };
}
