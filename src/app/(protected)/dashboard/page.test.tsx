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
    render(<DashboardPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
  });

  describe("route protection (established (protected) layout behavior)", () => {
    const frame = () => (
      <ProtectedLayout>
        <DashboardPage />
      </ProtectedLayout>
    );

    it("anonymous: the Dashboard is not rendered and the standard sign-in prompt is", () => {
      mockUseAuth.mockReturnValue({ status: "anonymous", user: null });
      render(frame());
      expect(screen.queryByTestId("dashboard-view")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    });

    it("session failure and an unreachable backend do not render the Dashboard either", () => {
      for (const status of ["session-failure", "unavailable", "initializing"]) {
        mockUseAuth.mockReturnValue({ status, user: null });
        const { unmount } = render(frame());
        expect(screen.queryByTestId("dashboard-view"), status).not.toBeInTheDocument();
        unmount();
      }
    });

    it("authenticated: the Dashboard renders", () => {
      mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role: "USER" } });
      render(frame());
      expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    });
  });
});
