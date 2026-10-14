/**
 * Single source of environment for the browser suite (#85).
 * The same values configure the backend process (playwright.config.ts) and
 * the seed script (global-setup.ts), so they cannot drift apart.
 */
export const WEB_PORT = 3000;
export const API_PORT = 5000;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_ORIGIN = `http://localhost:${API_PORT}`;

/** Must end in `_e2e`: server/scripts/seed-e2e.js refuses to wipe anything else. */
export const E2E_MONGO_URI =
  process.env.E2E_MONGO_URI ?? "mongodb://127.0.0.1:27017/aquaveda_v2_e2e";

/** Throwaway, test-only values (not credentials). */
export const BACKEND_ENV: Record<string, string> = {
  PORT: String(API_PORT),
  MONGO_URI: E2E_MONGO_URI,
  JWT_ACCESS_SECRET: "e2e-only-access-secret-not-for-production-0001",
  JWT_REFRESH_SECRET: "e2e-only-refresh-secret-not-for-production-0002",
  ALLOWED_ORIGINS: WEB_ORIGIN,
  COOKIE_SAME_SITE: "none",
  COOKIE_DOMAIN: "",
};
