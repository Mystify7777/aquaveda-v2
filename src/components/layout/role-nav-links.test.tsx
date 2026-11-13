import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MobileNav } from "@/components/layout/mobile-nav";
import { Navbar } from "@/components/layout/navbar";
import { RoleNavLinks } from "@/components/layout/role-nav-links";

vi.mock("@/components/layout/auth-controls", () => ({ AuthControls: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const as = (role: string | null, status = "authenticated") =>
  mockUseAuth.mockReturnValue({ status, user: role ? { id: "u1", role } : null });

const LABELS = ["Become an Expert", "Review queue", "Needs attention", "Expert applications"] as const;
const present = (container: HTMLElement) =>
  LABELS.filter((label) => container.querySelector(`a`) && screen.queryAllByRole("link", { name: label }).length > 0);

beforeEach(() => mockUseAuth.mockReset());

describe("RoleNavLinks", () => {
  it("renders nothing for every non-authenticated state", () => {
    for (const status of ["anonymous", "initializing", "unavailable", "session-failure"]) {
      as(null, status);
      const { container, unmount } = render(<RoleNavLinks className="x" />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("an authenticated session with an unknown role gets no links", () => {
    as("SUPERUSER");
    const { container } = render(<RoleNavLinks className="x" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("primary navigation adapts to the role (desktop)", () => {
  it("USER sees the Expert application entry, not review or governance", () => {
    as("USER");
    const { container } = render(<Navbar />);
    expect(screen.getByRole("link", { name: "Become an Expert" })).toHaveAttribute("href", "/learn/expert-application");
    expect(present(container)).toEqual(["Become an Expert"]);
  });

  it("EXPERT sees both Knowledge review and Issue attention queues", () => {
    as("EXPERT");
    const { container } = render(<Navbar />);
    expect(screen.getByRole("link", { name: "Review queue" })).toHaveAttribute("href", "/learn/review");
    expect(screen.getByRole("link", { name: "Needs attention" })).toHaveAttribute("href", "/dashboard/attention");
    expect(present(container)).toEqual(["Review queue", "Needs attention"]);
  });

  it("ADMIN sees Expert-application governance, and NOT the Knowledge review queue", () => {
    as("ADMIN");
    const { container } = render(<Navbar />);
    expect(screen.getByRole("link", { name: "Expert applications" })).toHaveAttribute("href", "/admin/expert-applications");
    expect(present(container)).toEqual(["Expert applications"]);
  });

  it("anonymous visitors see only the public items", () => {
    as(null, "anonymous");
    const { container } = render(<Navbar />);
    expect(present(container)).toEqual([]);
    expect(screen.getByRole("link", { name: "Explore" })).toBeInTheDocument();
  });
});

describe("mobile navigation adapts to the role", () => {
  for (const [role, label, href, expectedLabels] of [
    ["USER", "Become an Expert", "/learn/expert-application", ["Become an Expert"]],
    ["EXPERT", "Review queue", "/learn/review", ["Review queue", "Needs attention"]],
    ["EXPERT", "Needs attention", "/dashboard/attention", ["Review queue", "Needs attention"]],
    ["ADMIN", "Expert applications", "/admin/expert-applications", ["Expert applications"]],
  ] as const) {
    it(`${role} drawer includes "${label}" and none of the other roles' entries`, async () => {
      as(role);
      const { container } = render(<MobileNav />);
      await userEvent.setup().click(screen.getByRole("button", { name: "Open navigation menu" }));
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
      expect(present(container.ownerDocument.body)).toEqual(expectedLabels);
    });
  }
});
