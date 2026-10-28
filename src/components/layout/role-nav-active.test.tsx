import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { RoleNavLinks } from "@/components/layout/role-nav-links";

const mockUsePathname = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => mockUsePathname() }));
const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const as = (role: string) => mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role } });

beforeEach(() => {
  mockUseAuth.mockReset();
  mockUsePathname.mockReset();
});

describe("RoleNavLinks active state (same rule as the primary links)", () => {
  it.each([
    ["USER", "Become an Expert", "/learn/expert-application"],
    ["EXPERT", "Review queue", "/learn/review"],
    ["ADMIN", "Expert applications", "/admin/expert-applications"],
  ])("%s: '%s' is aria-current=page on its exact route and 'true' on nested routes", (role, label, href) => {
    as(role);
    mockUsePathname.mockReturnValue(href);
    const exact = render(<RoleNavLinks className="base" activeClassName="is-active" />);
    const link = screen.getByRole("link", { name: new RegExp(label) });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("is-active");
    exact.unmount();

    mockUsePathname.mockReturnValue(`${href}/details`);
    render(<RoleNavLinks className="base" activeClassName="is-active" />);
    expect(screen.getByRole("link", { name: new RegExp(label) })).toHaveAttribute("aria-current", "true");
  });

  it("is not active on other routes and applies no active class", () => {
    as("EXPERT");
    mockUsePathname.mockReturnValue("/learn");
    render(<RoleNavLinks className="base" activeClassName="is-active" />);
    const link = screen.getByRole("link", { name: /Review queue/ });
    expect(link).not.toHaveAttribute("aria-current");
    expect(link.className).not.toContain("is-active");
  });
});
