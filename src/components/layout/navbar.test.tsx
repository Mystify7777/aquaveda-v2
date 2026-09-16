import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { Navbar } from "@/components/layout/navbar";

/**
 * Navbar renders MobileNav (a Client Component using next/navigation's
 * usePathname), ThemeToggle (a Client Component using next-themes), and
 * AuthControls (a Client Component using useAuth(), which requires an
 * AuthProvider ancestor in real usage).
 *
 * AuthControls is mocked here rather than wrapping the tree in a real
 * AuthProvider. This is a navigation-focused unit test — its job is to
 * verify Navbar's links and structure, not auth behavior (which has
 * its own dedicated coverage: src/lib/auth-state.test.js for the
 * session-state machine, and AuthControls' own future test file for
 * its rendering per status). Using the real AuthProvider here would
 * additionally require mocking @/lib/api/auth's getCurrentUser/
 * refreshSession to avoid a real network call from AuthProvider's
 * bootstrap effect, and would couple every Navbar test to an
 * irrelevant async initialization sequence. Mocking at the
 * AuthControls boundary keeps this test deterministic, fast, and
 * scoped to what it actually verifies.
 */
vi.mock("@/components/layout/auth-controls", () => ({
  AuthControls: () => <div data-testid="auth-controls-stub" />,
}));

describe("Navbar", () => {
  it("renders a link to home", () => {
    render(<Navbar />);
    const homeLink = screen.getByRole("link", { name: /aquaveda/i });
    expect(homeLink).toHaveAttribute("href", "/");
  });

  it("renders all 5 primary nav items with the correct hrefs", () => {
    render(<Navbar />);
    const nav = screen.getByRole("navigation", { name: "Primary" });

    const expected = [
      ["Explore", "/explore"],
      ["Learn", "/learn"],
      ["Act", "/act"],
      ["Community", "/community"],
      ["Dashboard", "/dashboard"],
    ] as const;

    for (const [label, href] of expected) {
      const link = within(nav).getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
    }
  });
});
