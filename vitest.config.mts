import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Frontend test runner configuration (Issue #3 — testing foundation).
 *
 * Vitest + React Testing Library + jsdom, chosen as the smallest
 * appropriate stack for behavior-oriented component/unit tests in this
 * Next.js 16 / React 19 / TypeScript App Router project:
 *
 * - Vitest: ESM-native, no Babel/next/jest transform layer needed on
 *   top of what Vite already does for JSX/TSX — a smaller footprint
 *   than Jest + next/jest + its moduleNameMapper/transform config for
 *   this repo's needs (component and pure-function tests, not a full
 *   Next.js runtime simulation).
 * - jsdom over happy-dom: broader DOM API compatibility, which matters
 *   here specifically because next-themes and Radix Dialog (used by
 *   ThemeToggle/MobileNav) rely on DOM behavior (matchMedia,
 *   portals/focus handling) that happy-dom's smaller surface doesn't
 *   always cover identically.
 * - No MSW/network-mocking library: only 1-2 call sites use `fetch`
 *   (via lib/api/client.ts), mocked directly with vi.fn()/vi.spyOn —
 *   a dedicated mocking library would be premature for this surface
 *   area.
 * - No E2E tooling (Playwright/Cypress): nothing in the current
 *   codebase demonstrates a concrete need for full-browser/multi-page
 *   E2E coverage yet (per the issue's own constraint) — every current
 *   behavior worth testing (rendering, interaction, accessibility
 *   attributes) is reachable at the component level.
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.mts"],
    css: false,
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/server/**",
      "**/dist/**",
      "**/assists/**",
    ],
  },
});
