import { isIP } from "node:net";

import { resolveTrustedProxyHops } from "../config/env.js";
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
 * Identification: strictly by IP address, resolved by `resolveClientIp`
 * (socket address, or the `x-forwarded-for` entry appended by the Nth
 * TRUSTED proxy — see TRUSTED_PROXY_HOPS; Issue #27). NEVER by email,
 * username, or any request-body field, to prevent account enumeration
 * and account lock-out attacks (Issue #42 security requirement).
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
 * Resolves the client IP used as the rate-limit key.
 *
 * `X-Forwarded-For` and `X-Real-IP` are ordinary request headers: a client
 * can send any value, and common platform proxies APPEND to (not replace) a
 * client-supplied `X-Forwarded-For`. Trusting the leftmost entry therefore
 * lets one client mint unlimited keys and bypass every limiter (Issue #27).
 *
 * Instead only the entries added by trusted proxies are believed: with
 * `trustedProxyHops = N` the client is the Nth entry from the RIGHT. With 0
 * (default outside production) no forwarded header is trusted. `X-Real-IP`
 * is never trusted (a single, unverifiable header). Anything that does not
 * add up falls back to the socket address: a header with fewer entries than
 * `trustedProxyHops`, or a selected entry that is not a valid IP (junk,
 * port-suffixed). So a malformed header or a too-high hop count cannot make
 * the leftmost (client-supplied) entry the key, nor create arbitrary or
 * unbounded keys from header text.
 *
 * Limits no code can detect (documented in the audit report): a hop count
 * that is too high while the header still carries enough entries, and
 * direct access to the origin that bypasses the proxy (the origin must only
 * be reachable through it). In both, a client can again choose its key.
 *
 * @param {import('express').Request} req
 * @param {number} [trustedProxyHops] defaults to TRUSTED_PROXY_HOPS
 * @returns {string} The resolved client IP address.
 */
export function resolveClientIp(req, trustedProxyHops = resolveTrustedProxyHops()) {
  const socketAddress = req.socket?.remoteAddress || "unknown";
  if (trustedProxyHops === 0) return socketAddress;

  const header = req.headers?.["x-forwarded-for"];
  if (typeof header !== "string") return socketAddress;

  const entries = header
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  // Fewer entries than trusted hops means the chain is not what the
  // configuration claims (header stripped, or the request reached the app
  // without passing every trusted proxy). The leftmost entry is then
  // client-controlled, so never fall back to it: use the socket address.
  if (entries.length < trustedProxyHops) return socketAddress;

  const candidate = entries[entries.length - trustedProxyHops];
  return candidate && isIP(candidate) ? candidate : socketAddress;
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

  // Window length last used for each key. The reaper needs it: a key is only
  // dead once its NEWEST hit has aged out of ITS OWN window. (Issue #27: the
  // reaper previously compared the newest hit against `now` alone, which is
  // always true, so it wiped live counters every tick regardless of window
  // length — a 1-hour limit effectively reset every cleanup interval.)
  /** @type {Map<string, number>} */
  const windows = new Map();

  /**
   * Periodic reaper — removes only keys that no window can still reference,
   * i.e. whose newest timestamp + that key's window has passed. Live counters
   * are never evicted. (hit() also prunes per key on access; this catches
   * keys that stopped receiving traffic.)
   */
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of store) {
      const newest = timestamps[timestamps.length - 1];
      if (newest === undefined || newest + (windows.get(key) ?? 0) <= now) {
        store.delete(key);
        windows.delete(key);
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
      // One key normally belongs to one limiter (distinct keyPrefix), but if a
      // key is ever shared, keep the LONGEST window seen so the reaper can
      // never evict a counter that a longer-window limiter still needs.
      windows.set(key, Math.max(windows.get(key) ?? 0, windowMs));

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
      windows.clear();
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
 * @param {string} [options.keyPrefix] - Prefix that namespaces this limiter's keys in a
 *   shared store (e.g., "login:", "register:"). INVARIANT: every limiter that shares a
 *   store MUST use a distinct prefix, so one store key always belongs to exactly one
 *   limiter and one window. Same prefix ⇒ the limiters share counters (and the store
 *   retains the key for the longest window either used).
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
