import { defineConfig, devices } from "@playwright/test";

import {
  API_ORIGIN,
  BACKEND_ENV,
  WEB_ORIGIN,
  WEB_PORT,
} from "./e2e/env";

/**
 * Browser smoke suite (#85): deliberately small. Requires MongoDB at
 * E2E_MONGO_URI (see e2e/env.ts). Runs against the production build
 * (`next start`), the real Express backend and real auth — nothing mocked.
 * Readiness is deterministic: Playwright blocks until each `url` answers.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm --prefix server start",
      url: `${API_ORIGIN}/api/v1/health`,
      env: BACKEND_ENV,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Build and serve in ONE process env: Next inlines NEXT_PUBLIC_* at BUILD
      // time (src/lib/api/client.ts has no default), so the build must see
      // NEXT_PUBLIC_API_URL too, not just `next start`. Otherwise browser auth
      // calls go same-origin and 404.
      command: `npm run build && npm run start -- --port ${WEB_PORT}`,
      url: WEB_ORIGIN,
      env: { NEXT_PUBLIC_API_URL: API_ORIGIN },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
