import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

/**
 * AuthControls is mocked here for the same reason as navbar.test.tsx —
 * see that file's header comment for the full justification. MobileNav
 * mounts <AuthControls mobile /> inside its drawer content, which
 * calls useAuth() and would throw without an AuthProvider ancestor;
 * this test's actual concern is drawer open/close and navigation
 * behavior, not auth rendering.
 */
vi.mock("@/components/layout/auth-controls", () => ({
  AuthControls: () => <div data-testid="auth-controls-stub" />,
}));

// RoleNavLinks (#91 UI) reads the session via useAuth; these tests cover the
// static navigation only, so the session is anonymous (no role links).
// Role-aware links have their own coverage in role-nav-links.test.tsx.
vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ status: "anonymous", user: null }),
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

  describe("active route", () => {
    const openDrawer = async () => {
      const user = userEvent.setup();
      render(<MobileNav />);
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      return user;
    };
    const current = () =>
      within(screen.getByRole("navigation", { name: "Mobile primary" }))
        .getAllByRole("link")
        .filter((link) => link.hasAttribute("aria-current"));

    it("exposes aria-current=\"page\" on the exact route", async () => {
      mockUsePathname.mockReturnValue("/act");
      await openDrawer();
      expect(current().map((l) => [l.textContent, l.getAttribute("aria-current")])).toEqual([["Act", "page"]]);
    });

    it("marks the parent section for nested routes (same rule as desktop)", async () => {
      mockUsePathname.mockReturnValue("/learn/mine");
      await openDrawer();
      expect(current().map((l) => [l.textContent, l.getAttribute("aria-current")])).toEqual([["Learn", "true"]]);
    });

    it("shows a non-colour marker on the active link only", async () => {
      mockUsePathname.mockReturnValue("/explore");
      await openDrawer();
      expect(screen.getByRole("link", { name: "Explore" }).className).toContain("after:w-0.5");
      expect(screen.getByRole("link", { name: "Learn" }).className).not.toContain("after:w-0.5");
    });
  });

  describe("dismissal and stale state", () => {
    it("closes when a link to the CURRENT route is activated (pathname unchanged)", async () => {
      mockUsePathname.mockReturnValue("/explore");
      const user = userEvent.setup();
      render(<MobileNav />);
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      await user.click(screen.getByRole("link", { name: "Explore" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("closes when the drawer's logo link is activated", async () => {
      const user = userEvent.setup();
      render(<MobileNav />);
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "AquaVeda" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("can be reopened after navigating, showing the new active route (no stale state)", async () => {
      mockUsePathname.mockReturnValue("/");
      const user = userEvent.setup();
      const { rerender } = render(<MobileNav />);
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      mockUsePathname.mockReturnValue("/community");
      rerender(<MobileNav />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      expect(screen.getByRole("link", { name: "Community" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "Explore" })).not.toHaveAttribute("aria-current");
    });

    it("closes on Escape and returns focus to the trigger", async () => {
      const user = userEvent.setup();
      render(<MobileNav />);
      const trigger = screen.getByRole("button", { name: "Open navigation menu" });
      await user.click(trigger);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it("closes when the overlay (outside the drawer) is clicked", async () => {
      const user = userEvent.setup();
      render(<MobileNav />);
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      const overlay = document.querySelector('div[data-state="open"][aria-hidden="true"], div.fixed.inset-0');
      expect(overlay).not.toBeNull();
      await user.click(overlay as HTMLElement);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    describe("viewport growth", () => {
      const original = window.matchMedia;
      afterEach(() => {
        window.matchMedia = original;
      });

      function stubMedia(initialMatches: boolean) {
        let listener: ((e: MediaQueryListEvent) => void) | null = null;
        window.matchMedia = ((query: string) => ({
          matches: initialMatches,
          media: query,
          addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
            listener = cb;
          },
          removeEventListener: () => {
            listener = null;
          },
        })) as unknown as typeof window.matchMedia;
        return {
          cross: (matches: boolean) => listener?.({ matches } as MediaQueryListEvent),
          hasListener: () => listener !== null,
        };
      }

      it("closes an open drawer when the viewport reaches desktop width", async () => {
        const media = stubMedia(false);
        const user = userEvent.setup();
        render(<MobileNav />);
        await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        await act(async () => media.cross(true));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });

      it("stays open when the viewport change does not reach desktop width, and unsubscribes on close", async () => {
        const media = stubMedia(false);
        const user = userEvent.setup();
        render(<MobileNav />);
        await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
        await act(async () => media.cross(false));
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        await user.keyboard("{Escape}");
        expect(media.hasListener()).toBe(false);
      });
    });
  });

  describe("keyboard, semantics and touch targets", () => {
    it("trigger and close buttons have accessible names and 44px targets", async () => {
      const user = userEvent.setup();
      render(<MobileNav />);
      const trigger = screen.getByRole("button", { name: "Open navigation menu" });
      expect(trigger.className.split(/\s+/)).toContain("size-11");
      await user.click(trigger);
      const close = screen.getByRole("button", { name: "Close navigation menu" });
      expect(close.className.split(/\s+/)).toContain("size-11");
    });

    it("exposes a named modal dialog with the title as its accessible name", async () => {
      const user = userEvent.setup();
      render(<MobileNav />);
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      expect(screen.getByRole("dialog", { name: "Navigation menu" })).toBeInTheDocument();
    });

    it("opens without Radix accessibility warnings", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const user = userEvent.setup();
      render(<MobileNav />);
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      warn.mockRestore();
      error.mockRestore();
    });

    it("nav links meet the 44px minimum height and the drawer scrolls instead of overflowing", async () => {
      const user = userEvent.setup();
      render(<MobileNav />);
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      for (const link of within(screen.getByRole("navigation", { name: "Mobile primary" })).getAllByRole("link")) {
        expect(link.className.split(/\s+/), link.textContent ?? "").toContain("min-h-11");
      }
      const tokens = screen.getByRole("dialog").className.split(/\s+/);
      expect(tokens).toContain("overflow-y-auto");
      expect(tokens).toContain("overflow-x-hidden");
    });

    it("keeps focus inside the open drawer when tabbing past the last control", async () => {
      const user = userEvent.setup();
      render(<MobileNav />);
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      const dialog = screen.getByRole("dialog");
      for (let i = 0; i < 12; i++) {
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
    });

    it("does not neutralise the global focus ring on drawer controls", async () => {
      const user = userEvent.setup();
      render(<MobileNav />);
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      for (const el of within(screen.getByRole("dialog")).getAllByRole("link")) {
        expect(el.className).not.toMatch(/outline-none|ring-0/);
      }
    });
  });
});
