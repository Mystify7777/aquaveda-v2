import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import DashboardPage from "@/app/(protected)/dashboard/page";
import ProtectedLayout from "@/app/(protected)/layout";
import { resolveAppRoute } from "@/test-utils/app-routes";

const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("@/components/dashboard/dashboard-view", () => ({
  DashboardView: () => <div data-testid="dashboard-view" />,
}));

beforeEach(() => {
  mockUseAuth.mockReset();
});

describe("/dashboard page", () => {
  it("is served at the canonical /dashboard URL ((protected) is not a URL segment)", () => {
    expect(resolveAppRoute("/dashboard")).toBe("static");
    expect(resolveAppRoute("/protected/dashboard")).toBe("missing");
  });

  it("has one h1 and hands off to the Dashboard view", () => {
    mockUseAuth.mockReturnValue({ status: "authenticated", retryInitialization: vi.fn() });
    render(<ProtectedLayout><DashboardPage /></ProtectedLayout>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
  });

  it("anonymous: centers the authentication gate in the Dashboard content region", () => {
    mockUseAuth.mockReturnValue({ status: "anonymous", retryInitialization: vi.fn() });
    const { container } = render(<ProtectedLayout><DashboardPage /></ProtectedLayout>);
    expect(screen.queryByTestId("dashboard-view")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();

    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).toContain("min-h-[calc(100dvh-12rem)]");
    expect(frame.className).toContain("items-center");
    expect(frame.className).toContain("justify-center");
    expect(frame.className).toContain("text-center");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/auth/register");
  });

  it("session failure and an unreachable backend do not render Dashboard content", () => {
    for (const status of ["session-failure", "unavailable", "initializing"]) {
      mockUseAuth.mockReturnValue({ status, retryInitialization: vi.fn() });
      const { unmount } = render(<ProtectedLayout><DashboardPage /></ProtectedLayout>);
      expect(screen.queryByTestId("dashboard-view"), status).not.toBeInTheDocument();
      unmount();
    }
  });
});
