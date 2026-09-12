import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

// MobileNav is imported after the mock is registered (vi.mock is
// hoisted above imports by Vitest, so this ordering in source is fine,
// but the dynamic import below keeps the mock reset lifecycle explicit
// per test rather than relying on hoisting timing).
import { MobileNav } from "@/components/layout/mobile-nav";

describe("MobileNav", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/");
  });

  it("does not render the drawer content until opened", () => {
    render(<MobileNav />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the drawer when the trigger is clicked, showing all 5 nav links", async () => {
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));

    const dialog = screen.getByRole("dialog");
    const nav = within(dialog).getByRole("navigation", { name: "Mobile primary" });
    for (const label of ["Explore", "Learn", "Act", "Community", "Dashboard"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("closes the drawer when the close button is clicked", async () => {
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close navigation menu" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("highlights the nav link matching the current pathname", async () => {
    mockUsePathname.mockReturnValue("/explore");
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));

    const activeLink = screen.getByRole("link", { name: "Explore" });
    const inactiveLink = screen.getByRole("link", { name: "Learn" });
    // Exact class-token membership, not substring matching — every
    // link (active or not) carries a "hover:bg-muted" token, which a
    // plain .toContain("bg-muted") substring check would also match,
    // false-positiving on the inactive link too.
    const activeTokens = activeLink.className.split(/\s+/);
    const inactiveTokens = inactiveLink.className.split(/\s+/);
    expect(activeTokens).toContain("bg-muted");
    expect(inactiveTokens).not.toContain("bg-muted");
  });

  it("closes automatically when the pathname changes (navigation occurred)", async () => {
    mockUsePathname.mockReturnValue("/");
    const user = userEvent.setup();
    const { rerender } = render(<MobileNav />);

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Simulate the route having changed underneath the component.
    mockUsePathname.mockReturnValue("/learn");
    rerender(<MobileNav />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
