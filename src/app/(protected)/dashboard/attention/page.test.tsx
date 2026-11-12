import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import AttentionPage from "@/app/(protected)/dashboard/attention/page";
import ProtectedLayout from "@/app/(protected)/layout";
import { resolveAppRoute } from "@/test-utils/app-routes";

const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("@/components/expert/attention-queue", () => ({ AttentionQueue: () => <div data-testid="attention-queue" /> }));

describe("/dashboard/attention", () => {
  it("is a protected route and the route group is URL-transparent", () => {
    expect(resolveAppRoute("/dashboard/attention")).toBe("static");
    expect(resolveAppRoute("/protected/dashboard/attention")).toBe("missing");
  });

  it("renders the entry-point framing and queue consumer", () => {
    render(<AttentionPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
    expect(screen.getByTestId("attention-queue")).toBeInTheDocument();
  });

  it("anonymous viewers do not see the protected entry point", () => {
    mockUseAuth.mockReturnValue({ status: "anonymous", user: null });
    render(<ProtectedLayout><AttentionPage /></ProtectedLayout>);
    expect(screen.queryByTestId("attention-queue")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
  });

  it("USER and ADMIN sessions reach the route shell but cannot receive queue data without backend authorization", () => {
    for (const role of ["USER", "ADMIN"]) {
      mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role } });
      const { unmount } = render(<ProtectedLayout><AttentionPage /></ProtectedLayout>);
      expect(screen.getByTestId("attention-queue")).toBeInTheDocument();
      unmount();
    }
  });
});
