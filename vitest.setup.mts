import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Vitest does not auto-cleanup the DOM between tests the way Jest's
 * testing-library preset does — without this, each render() call
 * accumulates in the same jsdom document across tests in a file (and
 * can leak effects across files), causing false "multiple elements
 * found" failures and post-teardown "window is not defined" errors
 * from components whose effects were still scheduled.
 */
afterEach(() => {
  cleanup();
});

/**
 * jsdom does not implement window.matchMedia. next-themes (used by
 * ThemeProvider/ThemeToggle, mounted with enableSystem in the real
 * root layout) calls it to detect the OS-level color-scheme
 * preference. Without this polyfill, any test that renders something
 * inside a ThemeProvider throws "matchMedia is not a function" —
 * this is a known, standard gap in jsdom, not something specific to
 * this repo.
 */
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
