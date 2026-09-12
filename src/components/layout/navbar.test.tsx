import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { Navbar } from "@/components/layout/navbar";

/**
 * Navbar renders MobileNav (a Client Component using next/navigation's
 * usePathname) and ThemeToggle (a Client Component using next-themes).
 * Both need the same jsdom/matchMedia environment already set up in
 * vitest.setup.ts — no additional mocking is needed for Navbar itself
 * since it doesn't call either hook directly.
 */
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
