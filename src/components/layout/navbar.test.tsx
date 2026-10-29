import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
const mockUsePathname = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => mockUsePathname() }));

vi.mock("@/components/layout/auth-controls", () => ({
  AuthControls: () => <div data-testid="auth-controls-stub" />,
}));

// RoleNavLinks (#91 UI) reads the session via useAuth; these tests cover the
// static navigation only, so the session is anonymous (no role links).
// Role-aware links have their own coverage in role-nav-links.test.tsx.
vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ status: "anonymous", user: null }),
}));

describe("Navbar", () => {
  beforeEach(() => mockUsePathname.mockReturnValue("/"));

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

  describe("active route", () => {
    const primary = () => screen.getByRole("navigation", { name: "Primary" });
    const current = () =>
      within(primary())
        .getAllByRole("link")
        .filter((link) => link.hasAttribute("aria-current"));

    it("marks the exact route aria-current=\"page\" and nothing else", () => {
      mockUsePathname.mockReturnValue("/explore");
      render(<Navbar />);
      expect(current().map((l) => [l.textContent, l.getAttribute("aria-current")])).toEqual([["Explore", "page"]]);
    });

    it("highlights the parent section on nested routes but exposes no aria-current", () => {
      mockUsePathname.mockReturnValue("/explore/66a1f0c2");
      render(<Navbar />);
      expect(current()).toHaveLength(0);
      expect(within(primary()).getByRole("link", { name: "Explore" }).className).toContain("after:h-0.5");
    });

    it("marks nothing on the home page or on unrelated routes", () => {
      for (const path of ["/", "/auth/login", "/exploreX", "/unknown"]) {
        mockUsePathname.mockReturnValue(path);
        const { unmount } = render(<Navbar />);
        expect(current(), path).toHaveLength(0);
        unmount();
      }
    });

    it("gives the active link a visible, non-colour-only marker; inactive links get none", () => {
      mockUsePathname.mockReturnValue("/learn");
      render(<Navbar />);
      const active = within(primary()).getByRole("link", { name: "Learn" });
      const inactive = within(primary()).getByRole("link", { name: "Act" });
      expect(active.className).toContain("after:h-0.5");
      expect(inactive.className).not.toContain("after:h-0.5");
    });
  });

  describe("semantics and focus", () => {
    it("exposes a single labelled Primary landmark and a banner", () => {
      render(<Navbar />);
      expect(screen.getAllByRole("navigation", { name: "Primary" })).toHaveLength(1);
      expect(screen.getByRole("banner")).toBeInTheDocument();
    });

    it("every desktop nav link and the logo are reachable by Tab in DOM order", async () => {
      const user = userEvent.setup();
      render(<Navbar />);
      const order = ["AquaVeda", "Explore", "Learn", "Act", "Community", "Dashboard"];
      for (const name of order) {
        await user.tab();
        expect(document.activeElement).toBe(screen.getAllByRole("link", { name })[0]);
      }
    });

    it("does not neutralise the global focus ring on links (no outline-none/ring-0 overrides)", () => {
      render(<Navbar />);
      for (const link of screen.getAllByRole("link")) {
        expect(link.className).not.toMatch(/outline-none|ring-0|focus:outline-none/);
      }
    });

    it("sizes the theme toggle to a 44px touch target below md only", () => {
      render(<Navbar />);
      const toggle = screen.getAllByRole("button").find((b) => b.className.includes("max-md:size-11"));
      expect(toggle).toBeDefined();
    });
  });

  describe("component boundary", () => {
    it("the Navbar stays a Server Component; only NavLink/RoleNavLinks/MobileNav/ThemeToggle are client", () => {
      const read = (f: string) => readFileSync(`src/components/layout/${f}`, "utf8");
      expect(read("navbar.tsx")).not.toMatch(/^["']use client["']/m);
      for (const f of ["nav-link.tsx", "mobile-nav.tsx", "role-nav-links.tsx", "theme-toggle.tsx"]) {
        expect(read(f), f).toMatch(/^["']use client["']/m);
      }
    });
  });
});
