import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MobileNav } from "@/components/layout/mobile-nav";
import { Navbar } from "@/components/layout/navbar";
import { RoleNavLinks } from "@/components/layout/role-nav-links";
import type { MyExpertApplication } from "@/lib/api/types/expert-application";

vi.mock("@/components/layout/auth-controls", () => ({ AuthControls: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
const mockExpert = vi.fn();
vi.mock("@/components/expert/expert-status-provider", () => ({ useExpertStatus: () => mockExpert() }));

const as = (role: string) => mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role } });
const status = (over: Record<string, unknown> = {}) =>
  mockExpert.mockReturnValue({
    scope: "user",
    status: "ready",
    application: null,
    pendingCount: null,
    stale: false,
    error: null,
    refresh: vi.fn(),
    setApplication: vi.fn(),
    ...over,
  });
const app = (s: MyExpertApplication["status"]): MyExpertApplication => ({ status: s, history: [] });

beforeEach(() => {
  mockUseAuth.mockReset();
  mockExpert.mockReset();
});

describe("USER indicator", () => {
  it.each([
    ["pending", "Pending", "application pending review"],
    ["approved", "Approved", "application approved"],
    ["rejected", "Not approved", "application not approved"],
  ] as const)("%s: the link keeps its label, shows a chip, and announces the state", (s, chip, sr) => {
    as("USER");
    status({ application: app(s) });
    render(<RoleNavLinks className="x" />);
    const link = screen.getByRole("link", { name: `Become an Expert, ${sr}` });
    expect(link).toHaveAttribute("href", "/learn/expert-application");
    expect(link).toHaveTextContent(chip);
  });

  it("no chip before applying", () => {
    as("USER");
    status({ application: app("none") });
    render(<RoleNavLinks className="x" />);
    expect(screen.getByRole("link", { name: "Become an Expert" })).toBeInTheDocument();
  });

  it.each([
    ["loading", { status: "loading" }],
    ["error", { status: "error" }],
    ["stale (failed refresh)", { stale: true }],
    ["idle", { status: "idle" }],
  ])("neutral while %s: stale or missing data is never shown as current", (_n, over) => {
    as("USER");
    status({ application: app("pending"), ...over });
    render(<RoleNavLinks className="x" />);
    expect(screen.getByRole("link", { name: "Become an Expert" })).toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });
});

describe("ADMIN indicator", () => {
  it("shows the pending count on Expert applications, with an accessible name", () => {
    as("ADMIN");
    status({ scope: "admin", application: null, pendingCount: 4 });
    render(<RoleNavLinks className="x" />);
    expect(screen.getByRole("link", { name: "Expert applications, 4 pending applications" })).toHaveTextContent("4");
  });

  it("no badge at zero, while stale, or on error", () => {
    as("ADMIN");
    for (const over of [{ pendingCount: 0 }, { pendingCount: 4, stale: true }, { pendingCount: 4, status: "error" }]) {
      status({ scope: "admin", ...over });
      const { unmount } = render(<RoleNavLinks className="x" />);
      expect(screen.getByRole("link", { name: "Expert applications" })).toBeInTheDocument();
      unmount();
    }
  });

  it("never gives ADMIN the Knowledge review link (ADMIN is not an EXPERT)", () => {
    as("ADMIN");
    status({ scope: "admin", pendingCount: 2 });
    render(<RoleNavLinks className="x" />);
    expect(screen.queryByRole("link", { name: /review queue/i })).not.toBeInTheDocument();
  });
});

describe("EXPERT", () => {
  it("keeps the Knowledge review queue discoverable and gets no application chip", () => {
    as("EXPERT");
    status({ scope: "none", status: "idle" });
    render(<RoleNavLinks className="x" />);
    expect(screen.getByRole("link", { name: "Review queue" })).toHaveAttribute("href", "/learn/review");
    expect(screen.queryByText(/pending|approved/i)).not.toBeInTheDocument();
  });
});

describe("desktop and mobile navigation carry the same indicator", () => {
  it("desktop navbar", () => {
    as("USER");
    status({ application: app("pending") });
    render(<Navbar />);
    expect(screen.getAllByRole("link", { name: /Become an Expert, application pending review/ }).length).toBeGreaterThan(0);
  });

  it("mobile drawer", async () => {
    as("ADMIN");
    status({ scope: "admin", pendingCount: 3 });
    const user = userEvent.setup();
    render(<MobileNav />);
    await user.click(screen.getByRole("button", { name: /open navigation/i }));
    expect(await screen.findByRole("link", { name: /Expert applications, 3 pending applications/ })).toBeInTheDocument();
  });
});
