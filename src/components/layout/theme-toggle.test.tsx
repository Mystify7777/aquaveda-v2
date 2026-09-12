import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ThemeProvider } from "@/components/providers/theme-provider";

/**
 * The real root layout mounts ThemeProvider with defaultTheme="system"
 * and enableSystem. Tests here pin an explicit theme instead
 * (enableSystem={false}, defaultTheme="light") for determinism — this
 * plan's own constraint is that tests must be deterministic, and
 * resolving what the "system" preference evaluates to depends on
 * matchMedia mock nuances that are next-themes' own internal concern,
 * not this component's. attribute="class" is kept, matching real usage,
 * since that's what the toggle interaction actually affects.
 */
function renderWithTheme(ui: React.ReactElement) {
  return render(
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      {ui}
    </ThemeProvider>,
  );
}

describe("ThemeToggle", () => {
  it("renders a button with an aria-label describing the switch action, once mounted", async () => {
    renderWithTheme(<ThemeToggle />);
    // next-themes resolves its value asynchronously on mount (an
    // effect, not synchronous render) even in a client-only test
    // render, so the accessible name settles after a tick.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Switch to dark theme" }),
      ).toBeInTheDocument();
    });
  });

  it("toggles the html class and the button's label when clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(<ThemeToggle />);

    const button = await screen.findByRole("button", { name: "Switch to dark theme" });
    expect(document.documentElement.classList.contains("light")).toBe(true);

    await user.click(button);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(
      screen.getByRole("button", { name: "Switch to light theme" }),
    ).toBeInTheDocument();
  });
});
