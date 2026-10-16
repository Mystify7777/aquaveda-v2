import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Navbar } from "@/components/layout/navbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { LearnWorkflowLinks } from "@/components/knowledge/learn-workflow-links";
import { findBrokenLinks, internalHrefs } from "@/test-utils/app-routes";

/**
 * Issue #81 — public navigation links must target implemented pages.
 * Community and Dashboard are linked ahead of their milestones; they are
 * the ONLY accepted misses. When one gains a page, findBrokenLinks fails
 * until it is removed from this list.
 */
const DEFERRED = ["/community", "/dashboard"] as const;

vi.mock("@/components/layout/auth-controls", () => ({ AuthControls: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
beforeEach(() => mockUseAuth.mockReturnValue({ status: "anonymous", user: null }));

describe("navigation links resolve to implemented routes", () => {
  it("Navbar", () => {
    const { container } = render(<Navbar />);
    const hrefs = internalHrefs(container);
    expect(hrefs).toEqual(expect.arrayContaining(["/", "/explore", "/learn", "/act"]));
    expect(findBrokenLinks(hrefs, DEFERRED)).toEqual([]);
  });

  it("MobileNav drawer", async () => {
    render(<MobileNav />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open navigation menu" }));
    const hrefs = internalHrefs(document.body);
    expect(hrefs).toEqual(expect.arrayContaining(["/", "/explore", "/learn", "/act"]));
    expect(findBrokenLinks(hrefs, DEFERRED)).toEqual([]);
  });

  it("Learn workflow entry points (canonical URLs; (protected) is not a URL segment)", () => {
    mockUseAuth.mockReturnValue({ status: "authenticated", user: { role: "EXPERT" } });
    const { container } = render(<LearnWorkflowLinks />);
    const hrefs = internalHrefs(container);
    expect(hrefs.sort()).toEqual(["/learn/mine", "/learn/review"]);
    expect(findBrokenLinks(hrefs)).toEqual([]);
  });

  it("role-aware navigation entries resolve to implemented pages for every role (desktop and mobile)", async () => {
    for (const role of ["USER", "EXPERT", "ADMIN"]) {
      mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role } });
      const { container, unmount } = render(<Navbar />);
      const hrefs = internalHrefs(container);
      expect(findBrokenLinks(hrefs, DEFERRED)).toEqual([]);
      unmount();
      const mobile = render(<MobileNav />);
      await userEvent.setup().click(screen.getByRole("button", { name: "Open navigation menu" }));
      expect(findBrokenLinks(internalHrefs(document.body), DEFERRED)).toEqual([]);
      mobile.unmount();
    }
  });

  it("the new Expert/governance routes are canonical (no /protected or (protected) URL segment)", () => {
    for (const href of ["/learn/expert-application", "/admin/expert-applications"]) {
      expect(findBrokenLinks([href])).toEqual([]);
    }
    expect(findBrokenLinks(["/protected/learn/expert-application", "/protected/admin/expert-applications"]).length).toBe(2);
  });
});
