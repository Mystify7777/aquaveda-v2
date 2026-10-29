import { geocoderUnavailable, tooManyRequests } from "./errors.js";
import { compactLocationLabel } from "../domain/location-label.js";

/**
 * Forward-geocoding adapter (#134): free-text place query -> normalized
 * candidate places. Provider-agnostic at the boundary; the wire protocol is
 * the Nominatim-compatible `GET {base}/search?q=&format=jsonv2` (served by
 * OSMF Nominatim, self-hosted Nominatim, and Nominatim-compatible hosted
 * providers). Which provider is used in production is a deployment decision
 * (docs/architecture/geocoding-provider-comparison.md); this module only
 * enforces the behaviours every acceptable provider requires:
 *
 *  - identifying User-Agent on every request (provider policy);
 *  - application-wide request spacing (`minIntervalMs`, default 1.1s — the
 *    public OSMF limit is 1 req/s for the WHOLE app, not per user) with a
 *    bounded queue so a burst fails fast instead of piling up;
 *  - result caching (TTL + size bound) and in-flight de-duplication, so a
 *    repeated query costs no provider call and consumes no throttle slot;
 *  - hard timeout; every upstream failure collapses to GEOCODER_UNAVAILABLE
 *    with no provider detail;
 *  - privacy: only the normalized query text leaves the process. No cookies,
 *    client IP, user identity or device coordinates are forwarded, and the
 *    query text is never logged.
 *
 * Cache/throttle are per process (same limitation as the in-memory rate
 * limiter): N instances => N x the provider budget.
 */

export function normalizeQueryKey(query) {
  return query.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/** Provider item -> { label, latitude, longitude }, or null if unusable. */
function toResult(item) {
  const latitude = Number(item?.lat);
  const longitude = Number(item?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const label = compactLocationLabel(item?.display_name);
  if (!label) return null;
  return { label, latitude: round6(latitude), longitude: round6(longitude) };
}

/**
 * @param {{
 *   baseUrl: string, userAgent: string, apiKey?: string,
 *   attribution: { text: string, url: string },
 *   timeoutMs?: number, cacheTtlMs?: number, cacheMaxEntries?: number,
 *   minIntervalMs?: number, maxQueued?: number, resultLimit?: number,
 *   fetchImpl?: typeof fetch, now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   logger?: { warn: (...a: unknown[]) => void },
 * }} options
 */
export function createGeocoder({
  baseUrl,
  userAgent,
  apiKey,
  attribution,
  timeoutMs = 4000,
  cacheTtlMs = 24 * 60 * 60 * 1000,
  cacheMaxEntries = 500,
  minIntervalMs = 1100,
  maxQueued = 3,
  resultLimit = 5,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
}) {
  const base = baseUrl.replace(/\/+$/, "");
  const cache = new Map(); // key -> { expiresAt, results } ; insertion order = LRU order
  const inflight = new Map(); // key -> Promise<results>
  let nextSlot = 0;
  let queued = 0;

  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now()) {
      cache.delete(key);
      return undefined;
    }
    cache.delete(key); // refresh recency
    cache.set(key, hit);
    return hit.results;
  }

  function cacheSet(key, results) {
    cache.delete(key);
    cache.set(key, { expiresAt: now() + cacheTtlMs, results });
    while (cache.size > cacheMaxEntries) {
      cache.delete(cache.keys().next().value);
    }
  }

  async function acquireSlot() {
    if (queued >= maxQueued) {
      throw tooManyRequests("Place search is busy. Try again in a moment.");
    }
    queued += 1;
    try {
      const t = now();
      const wait = Math.max(0, nextSlot - t);
      nextSlot = Math.max(t, nextSlot) + minIntervalMs; // reserved synchronously
      if (wait > 0) await sleep(wait);
    } finally {
      queued -= 1;
    }
  }

  async function fetchFromProvider(query) {
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(resultLimit));
    url.searchParams.set("addressdetails", "0");
    if (apiKey) url.searchParams.set("key", apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { "User-Agent": userAgent, Accept: "application/json" },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        logger.warn(`[geocoder] upstream responded ${response.status}`);
        throw geocoderUnavailable("Place search is not available right now.");
      }
      let body;
      try {
        body = await response.json();
      } catch {
        logger.warn("[geocoder] upstream returned a non-JSON body");
        throw geocoderUnavailable("Place search is not available right now.");
      }
      if (!Array.isArray(body)) {
        logger.warn("[geocoder] upstream returned an unexpected shape");
        throw geocoderUnavailable("Place search is not available right now.");
      }
      return body.map(toResult).filter(Boolean).slice(0, resultLimit);
    } catch (error) {
      if (error?.code === "GEOCODER_UNAVAILABLE") throw error;
      logger.warn(`[geocoder] request failed (${error?.name === "AbortError" ? "timeout" : "network"})`);
      throw geocoderUnavailable("Place search is not available right now.");
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    attribution,
    /**
     * @param {string} rawQuery already validated by the route (3..200 chars)
     * @returns {Promise<{ results: {label:string, latitude:number, longitude:number}[], attribution: {text:string,url:string} }>}
     */
    async search(rawQuery) {
      const key = normalizeQueryKey(rawQuery);
      const cached = cacheGet(key);
      if (cached) return { results: cached, attribution };

      let pending = inflight.get(key);
      if (!pending) {
        pending = (async () => {
          await acquireSlot();
          const results = await fetchFromProvider(rawQuery);
          cacheSet(key, results);
          return results;
        })().finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      return { results: await pending, attribution };
    },
  };
}
