/**
 * Canonical, shared environment-configuration entry point.
 *
 * This is the intentional configuration boundary for modules that need
 * shared environment access — consumers (like `db.js`) should import
 * from here rather than relying on some unrelated module to load
 * environment variables as an accidental side effect.
 *
 * `server.js` separately retains its own entry-point-level
 * `import "dotenv/config"` line. That is intentional, not an oversight
 * this file is meant to replace: it's a harmless, idempotent safeguard
 * that keeps the application's true entry point self-sufficient even if
 * this module's own import chain ever changed. `dotenv/config`'s load
 * is idempotent and a no-op once environment variables are already
 * present, so this file and `server.js` both importing it is safe and
 * does not double-load or override already-set variables — the
 * important property this file provides is a single *named*,
 * intentional place for other modules to depend on, not literal
 * exclusivity over who is allowed to call `dotenv/config`.
 *
 * Why this file exists, specifically: `db.js` previously carried the
 * `dotenv/config` import on the reasoning that "it's the only module
 * that needs env vars, and everything else needing them goes through
 * it anyway." That was true for Phase D (only `connectDB()` and the
 * test suite needed env vars), but it made env loading an accidental
 * side effect of importing the database module rather than an
 * intentional configuration boundary — a future module needing, say, a
 * JWT secret would only get a populated `process.env` because it
 * happened to import something that happened to import `db.js`. This
 * file removes that hidden coupling: it is the actual, named
 * configuration entry point, and `db.js` now imports it explicitly for
 * the same reason any other module would.
 *
 * This module was originally authored with a minimal footprint before
 * Authentication was built. As of Issue #30 (auth secret hygiene), this
 * module is the canonical entry point for all environment configuration,
 * providing startup validation, cryptographic secret separation enforcement,
 * token lifetime validation, cookie resolution, and database separation guards.
 */

import "dotenv/config";

/**
 * Access and refresh token default lifetimes.
 */
export const DEFAULT_ACCESS_TOKEN_EXPIRES = "15m";
export const DEFAULT_REFRESH_TOKEN_EXPIRES = "7d";

/**
 * Known placeholder / insecure values that must never be used in production.
 */
const INSECURE_SECRET_PATTERNS = Object.freeze([
  "test-",
  "secret",
  "changeme",
  "placeholder",
  "password",
  "default",
  "admin",
  "12345",
]);

const VALID_SAME_SITE_VALUES = Object.freeze(["strict", "lax", "none"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Read a required environment variable, throwing a clear startup error
 * if it's missing rather than letting a consumer silently receive
 * `undefined` and fail later with a less legible error.
 *
 * @param {string} name - the environment variable's name
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {string} the variable's value
 */
export function getRequiredEnv(name, env = process.env) {
  const value = env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        "See server/README.md for the expected environment variables."
    );
  }
  return value;
}

/**
 * Parse a duration string (e.g. "15m", "7d", "30s", "24h") into milliseconds.
 * Throws clearly on anything else rather than guessing or allowing zero/negative durations.
 *
 * @param {string} duration
 * @returns {number} milliseconds
 */
export function parseDurationToMs(duration) {
  if (typeof duration !== "string") {
    throw new Error(
      `Unrecognized duration format: "${duration}". Expected a number ` +
        'followed by s/m/h/d, e.g. "7d".'
    );
  }
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) {
    throw new Error(
      `Unrecognized duration format: "${duration}". Expected a number ` +
        'followed by s/m/h/d, e.g. "7d".'
    );
  }
  const [, amountStr, unit] = match;
  const amount = Number(amountStr);
  if (amount <= 0) {
    throw new Error(
      `Invalid duration: "${duration}". Duration must be greater than zero.`
    );
  }
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * unitMs;
}

/**
 * Resolves the access token signing/verification secret.
 * Enforces that JWT_ACCESS_SECRET is set, non-empty, and NOT identical
 * to JWT_REFRESH_SECRET (access vs. refresh secret separation).
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {string}
 */
export function getAccessSecret(env = process.env) {
  const secret = getRequiredEnv("JWT_ACCESS_SECRET", env);
  const refreshSecret = env.JWT_REFRESH_SECRET;
  if (refreshSecret && secret === refreshSecret) {
    throw new Error(
      "Configuration security violation: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct secrets. " +
        "Reusing the same secret for both tokens breaches token separation invariants."
    );
  }
  return secret;
}

/**
 * Resolves the refresh token signing/verification secret.
 * Enforces that JWT_REFRESH_SECRET is set, non-empty, and NOT identical
 * to JWT_ACCESS_SECRET (access vs. refresh secret separation).
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {string}
 */
export function getRefreshSecret(env = process.env) {
  const secret = getRequiredEnv("JWT_REFRESH_SECRET", env);
  const accessSecret = env.JWT_ACCESS_SECRET;
  if (accessSecret && secret === accessSecret) {
    throw new Error(
      "Configuration security violation: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct secrets. " +
        "Reusing the same secret for both tokens breaches token separation invariants."
    );
  }
  return secret;
}

/**
 * Phase H — cookie deployment configuration.
 *
 * Resolved topology (locked, this deployment): frontend and backend are
 * on genuinely different registrable domains (real cross-site, not
 * sibling subdomains). This makes `SameSite=None` mandatory.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {string}
 */
export function resolveCookieSameSite(env = process.env) {
  const raw = (env.COOKIE_SAME_SITE || "none").toLowerCase();
  if (!VALID_SAME_SITE_VALUES.includes(raw)) {
    throw new Error(
      `Invalid COOKIE_SAME_SITE value: "${env.COOKIE_SAME_SITE}". ` +
        `Must be one of: ${VALID_SAME_SITE_VALUES.join(", ")}.`
    );
  }
  return raw;
}

/**
 * `COOKIE_DOMAIN` has no legitimate use in this deployment's cross-site
 * topology. Left unset by default; validated only if explicitly provided.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {string | undefined}
 */
export function resolveCookieDomain(env = process.env) {
  const raw = env.COOKIE_DOMAIN;
  if (!raw) return undefined;

  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes(" ") || !trimmed.includes(".")) {
    throw new Error(
      `Invalid COOKIE_DOMAIN value: "${raw}". Expected a bare domain ` +
        `(e.g. "example.com"), or leave unset for a host-only cookie.`
    );
  }
  return trimmed;
}

/**
 * Validates the authentication and session configuration.
 * Fails fast with clear diagnostics if configuration is invalid or violates
 * security posture constraints.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {true}
 */
export function validateAuthConfig(env = process.env) {
  // 1. Validate secrets presence and distinctness
  const accessSecret = getAccessSecret(env);
  const refreshSecret = getRefreshSecret(env);

  // 2. Validate token lifetimes and relative ordering
  const accessDuration = env.JWT_ACCESS_EXPIRES || DEFAULT_ACCESS_TOKEN_EXPIRES;
  const refreshDuration = env.JWT_REFRESH_EXPIRES || DEFAULT_REFRESH_TOKEN_EXPIRES;
  const accessMs = parseDurationToMs(accessDuration);
  const refreshMs = parseDurationToMs(refreshDuration);

  if (accessMs >= refreshMs) {
    throw new Error(
      `Invalid token lifetime configuration: JWT_ACCESS_EXPIRES ("${accessDuration}") ` +
        `must be strictly shorter than JWT_REFRESH_EXPIRES ("${refreshDuration}").`
    );
  }

  // 3. Validate cookie options
  resolveCookieSameSite(env);
  resolveCookieDomain(env);

  // 4. Production hygiene checks
  if (env.NODE_ENV === "production") {
    if (accessSecret.length < 32) {
      throw new Error(
        "Production security violation: JWT_ACCESS_SECRET must be at least 32 characters long. " +
          "Generate a secure secret with: openssl rand -base64 32"
      );
    }
    if (refreshSecret.length < 32) {
      throw new Error(
        "Production security violation: JWT_REFRESH_SECRET must be at least 32 characters long. " +
          "Generate a secure secret with: openssl rand -base64 32"
      );
    }

    const lowerAccess = accessSecret.toLowerCase();
    const lowerRefresh = refreshSecret.toLowerCase();
    for (const pattern of INSECURE_SECRET_PATTERNS) {
      if (lowerAccess.includes(pattern) || lowerRefresh.includes(pattern)) {
        throw new Error(
          `Production security violation: JWT secrets must not contain predictable placeholder pattern "${pattern}".`
        );
      }
    }

    const allowedOrigins = (env.ALLOWED_ORIGINS || "").trim();
    if (!allowedOrigins) {
      throw new Error(
        "Production configuration error: ALLOWED_ORIGINS must be set in production for credentialed CORS."
      );
    }
    const originList = allowedOrigins.split(",").map((s) => s.trim());
    if (originList.includes("*")) {
      throw new Error(
        "Production security violation: ALLOWED_ORIGINS must not contain wildcard '*' when cookies/credentials are enabled."
      );
    }
  }

  return true;
}

export const PUBLIC_OSMF_NOMINATIM_HOST = "nominatim.openstreetmap.org";
const DEV_GEOCODER_BASE_URL = `https://${PUBLIC_OSMF_NOMINATIM_HOST}`;
const DEV_GEOCODER_USER_AGENT =
  "AquaVeda-v2-dev/0.1 (development; https://github.com/Mystify7777/aquaveda-v2)";


/**
 * Geocoding provider configuration (Issue #134).
 *
 * The public OSMF Nominatim instance is a compliant DEVELOPMENT default only
 * (1 req/s for the whole app, no autocomplete, identifying User-Agent,
 * caching required). In production the feature is DISABLED (the endpoint
 * answers GEOCODER_UNAVAILABLE and the UI degrades to coordinate entry)
 * until an explicit provider is configured; production configuration that
 * points at the public OSMF host is refused at startup.
 *
 * Variables (all optional outside production):
 *   GEOCODER_BASE_URL          Nominatim-compatible base URL (https; http only for localhost)
 *   GEOCODER_USER_AGENT        required in production when enabled
 *   GEOCODER_API_KEY           sent as `key=` query parameter when set; server-side only
 *   GEOCODER_TIMEOUT_MS        500..15000, default 4000
 *   GEOCODER_MIN_INTERVAL_MS   >=0, default 1100 (>=1000 enforced for the public OSMF host)
 *   GEOCODER_CACHE_TTL_MS      >=60000, default 86400000
 *   GEOCODER_ATTRIBUTION_TEXT  default "© OpenStreetMap contributors"
 *   GEOCODER_ATTRIBUTION_URL   https URL, default https://www.openstreetmap.org/copyright
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {{ enabled: false, reason: string } | {
 *   enabled: true, baseUrl: string, userAgent: string, apiKey?: string,
 *   timeoutMs: number, minIntervalMs: number, cacheTtlMs: number,
 *   attribution: { text: string, url: string } }}
 */
function geocoderInt(env, name, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const raw = (env[name] ?? "").trim();
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${name} value: "${env[name]}". Expected an integer between ${min} and ${max}.`);
  }
  return n;
}

export function resolveGeocoderConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const rawUrl = (env.GEOCODER_BASE_URL ?? "").trim();

  if (!rawUrl && isProduction) {
    return { enabled: false, reason: "GEOCODER_BASE_URL is not set in production" };
  }

  const baseUrl = rawUrl || DEV_GEOCODER_BASE_URL;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid GEOCODER_BASE_URL value: "${env.GEOCODER_BASE_URL}". Expected an absolute URL.`);
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal && !isProduction)) {
    throw new Error("Invalid GEOCODER_BASE_URL: must be https (http is allowed only for localhost outside production).");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Invalid GEOCODER_BASE_URL: must not contain credentials, a query string or a fragment (use GEOCODER_API_KEY).");
  }
  const isPublicOsmf = parsed.hostname.toLowerCase() === PUBLIC_OSMF_NOMINATIM_HOST;
  if (isProduction && isPublicOsmf) {
    throw new Error(
      "Production configuration error: GEOCODER_BASE_URL must not be the public OSMF Nominatim instance " +
        "(development-only usage policy). Use a self-hosted or commercial provider."
    );
  }

  const userAgent = (env.GEOCODER_USER_AGENT ?? "").trim();
  if (isProduction && !userAgent) {
    throw new Error("Production configuration error: GEOCODER_USER_AGENT must identify the application when the geocoder is enabled.");
  }

  const minIntervalMs = geocoderInt(env, "GEOCODER_MIN_INTERVAL_MS", 1100, isPublicOsmf ? 1000 : 0);
  const timeoutMs = geocoderInt(env, "GEOCODER_TIMEOUT_MS", 4000, 500, 15000);
  const cacheTtlMs = geocoderInt(env, "GEOCODER_CACHE_TTL_MS", 24 * 60 * 60 * 1000, 60_000);

  const attributionUrl = (env.GEOCODER_ATTRIBUTION_URL ?? "").trim() || "https://www.openstreetmap.org/copyright";
  let attrParsed;
  try {
    attrParsed = new URL(attributionUrl);
  } catch {
    attrParsed = null;
  }
  if (!attrParsed || attrParsed.protocol !== "https:") {
    throw new Error(`Invalid GEOCODER_ATTRIBUTION_URL value: "${env.GEOCODER_ATTRIBUTION_URL}". Expected an https URL.`);
  }
  const attributionText = (env.GEOCODER_ATTRIBUTION_TEXT ?? "").trim() || "© OpenStreetMap contributors";
  if (attributionText.length > 120 || /[<>]/.test(attributionText)) {
    throw new Error("Invalid GEOCODER_ATTRIBUTION_TEXT: at most 120 characters, no '<' or '>'.");
  }

  const apiKey = (env.GEOCODER_API_KEY ?? "").trim() || undefined;
  return {
    enabled: true,
    baseUrl: parsed.toString().replace(/\/+$/, ""),
    userAgent: userAgent || DEV_GEOCODER_USER_AGENT,
    apiKey,
    timeoutMs,
    minIntervalMs,
    cacheTtlMs,
    attribution: { text: attributionText, url: attrParsed.toString() },
  };
}

/**
 * Validates the startup configuration for the process (server.js).
 * Fails fast before opening database connections or starting HTTP listeners.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {true}
 */
export function validateStartupConfig(env = process.env) {
  // Validate database connection configuration
  const mongoUri = env.MONGO_URI;
  if (!mongoUri || mongoUri.trim() === "") {
    throw new Error(
      "Missing required environment variable: MONGO_URI. " +
        "See server/README.md for the expected environment variables."
    );
  }

  // Validate authentication and session configuration
  validateAuthConfig(env);

  // Geocoder (#134): fail fast on malformed/forbidden values. Absent config in
  // production is NOT an error — the feature is simply disabled.
  resolveGeocoderConfig(env);

  return true;
}

/**
 * Checks whether two MongoDB connection strings target the exact same database.
 * Normalizes loopback aliases (localhost, 127.0.0.1, [::1]), default ports,
 * trailing slashes, and query parameters.
 *
 * @param {string} [uriA]
 * @param {string} [uriB]
 * @returns {boolean}
 */
export function isSameMongoDatabase(uriA, uriB) {
  if (typeof uriA !== "string" || typeof uriB !== "string") return false;
  const trimmedA = uriA.trim();
  const trimmedB = uriB.trim();
  if (!trimmedA || !trimmedB) return false;
  if (trimmedA === trimmedB) return true;

  try {
    const urlA = new URL(trimmedA);
    const urlB = new URL(trimmedB);

    const hostA = urlA.hostname.toLowerCase();
    const hostB = urlB.hostname.toLowerCase();
    const isLoopbackA = LOOPBACK_HOSTS.has(hostA);
    const isLoopbackB = LOOPBACK_HOSTS.has(hostB);

    const sameHost = (isLoopbackA && isLoopbackB) || hostA === hostB;
    const portA = urlA.port || (urlA.protocol === "mongodb:" ? "27017" : "");
    const portB = urlB.port || (urlB.protocol === "mongodb:" ? "27017" : "");
    const samePort = portA === portB;

    const dbA = decodeURIComponent(urlA.pathname.replace(/^\/+|\/+$/g, "")).toLowerCase();
    const dbB = decodeURIComponent(urlB.pathname.replace(/^\/+|\/+$/g, "")).toLowerCase();
    const sameDb = dbA === dbB;

    return sameHost && samePort && sameDb;
  } catch {
    return false;
  }
}

/**
 * Asserts that the test database URI does not point to the application development
 * database. Prevents accidental wiping of development data during test execution.
 *
 * @param {string} [testUri]
 * @param {string} [devUri]
 */
export function assertTestDatabaseSeparation(testUri, devUri) {
  if (!testUri || typeof testUri !== "string" || testUri.trim() === "") {
    throw new Error("TEST_MONGO_URI is required for test database execution.");
  }

  // Preserved verbatim guard check: exact string match
  if (devUri && testUri === devUri) {
    throw new Error(
      "TEST_MONGO_URI must not be the same as MONGO_URI — refusing to " +
        "run tests against the development database."
    );
  }

  // Canonical normalization check: loopback aliases, port, db name normalization
  if (devUri && isSameMongoDatabase(testUri, devUri)) {
    throw new Error(
      "TEST_MONGO_URI must not target the same database as MONGO_URI — refusing to " +
        "run tests against the development database."
    );
  }

  // Guard against running test suite on a database dedicated to dev/seed
  try {
    const url = new URL(testUri);
    const dbName = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ""));
    if (dbName.endsWith("_dev")) {
      throw new Error(
        `TEST_MONGO_URI database "${dbName}" ends with "_dev" — refusing to ` +
          "run tests against a development database."
      );
    }
  } catch (err) {
    if (err.message.includes('ends with "_dev"')) {
      throw err;
    }
  }
}

