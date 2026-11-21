import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import DashboardPage from "@/app/(protected)/dashboard/page";
import { resolveAppRoute } from "@/test-utils/app-routes";

vi.mock("@/components/dashboard/dashboard-view", () => ({
  DashboardView: () => <div data-testid="dashboard-view" />,
}));

describe("/dashboard page", () => {
  it("is served at the canonical /dashboard URL ((protected) is not a URL segment)", () => {
    expect(resolveAppRoute("/dashboard")).toBe("static");
    expect(resolveAppRoute("/protected/dashboard")).toBe("missing");
  });

  it("renders the Dashboard content", () => {
    render(<DashboardPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
  });
});
