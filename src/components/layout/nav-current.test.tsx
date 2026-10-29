import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MobileNav } from "@/components/layout/mobile-nav";
import { Navbar } from "@/components/layout/navbar";

/**
 * Regression for the multi-current edge case: primary links and role links share
 * ONE navigation landmark, so together they must expose at most one
 * aria-current, while the section highlight stays visible. Real NavLink and
 * RoleNavLinks (not mocked) are rendered inside both desktop and mobile navs.
 */
const mockUsePathname = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => mockUsePathname() }));
vi.mock("@/components/layout/auth-controls", () => ({ AuthControls: () => null }));
const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const MARKER = /after:(h-0\.5|w-0\.5)/; // desktop underline / mobile side bar

type Surface = { name: string; landmark: () => HTMLElement; mount: () => Promise<void> };
const surfaces: Surface[] = [
  {
    name: "desktop navbar",
    landmark: () => screen.getByRole("navigation", { name: "Primary" }),
    mount: async () => void render(<Navbar />),
  },
  {
    name: "mobile drawer",
    landmark: () => screen.getByRole("navigation", { name: "Mobile primary" }),
    mount: async () => {
      render(<MobileNav />);
      await userEvent.setup().click(screen.getByRole("button", { name: "Open navigation menu" }));
    },
  },
];

const cases: Array<{
  role: string;
  path: string;
  expectCurrent: string | null; // link whose aria-current must be "page"
  highlighted: string[]; // links that must carry the visual marker
}> = [
  { role: "USER", path: "/learn/expert-application", expectCurrent: "Become an Expert", highlighted: ["Learn", "Become an Expert"] },
  { role: "EXPERT", path: "/learn/review", expectCurrent: "Review queue", highlighted: ["Learn", "Review queue"] },
  { role: "ADMIN", path: "/admin/expert-applications", expectCurrent: "Expert applications", highlighted: ["Expert applications"] },
  // nested admin route: not a destination in the set → nothing is current, section still highlighted
  { role: "ADMIN", path: "/admin/expert-applications/66a1f0c2", expectCurrent: null, highlighted: ["Expert applications"] },
  // nested non-role route for each role: only the primary section is highlighted
  { role: "USER", path: "/learn/mine", expectCurrent: null, highlighted: ["Learn"] },
];

beforeEach(() => {
  mockUseAuth.mockReset();
  mockUsePathname.mockReset();
});

describe.each(surfaces)("one current destination per landmark — $name", (surface) => {
  it.each(cases)("$role on $path", async ({ role, path, expectCurrent, highlighted }) => {
    mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role } });
    mockUsePathname.mockReturnValue(path);
    await surface.mount();

    const links = within(surface.landmark()).getAllByRole("link");
    const current = links.filter((l) => l.hasAttribute("aria-current"));

    // Semantics: at most one, always "page", exactly the intended destination.
    expect(current.length).toBeLessThanOrEqual(1);
    for (const l of current) expect(l).toHaveAttribute("aria-current", "page");
    expect(current.map((l) => l.textContent?.split(/pending|approved|rejected|—/i)[0].trim() ?? "")).toEqual(
      expectCurrent ? [expect.stringContaining(expectCurrent)] : [],
    );

    // Visual section highlight is unchanged: exactly the expected links carry the marker.
    const marked = links.filter((l) => MARKER.test(l.className)).map((l) => l.textContent ?? "");
    expect(marked).toHaveLength(highlighted.length);
    for (const name of highlighted) expect(marked.some((t) => t.includes(name)), name).toBe(true);
  });
});
