import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import ExpertApplicationsPage from "@/app/(protected)/admin/expert-applications/page";
import ExpertApplicationPage from "@/app/(protected)/learn/expert-application/page";

vi.mock("@/components/expert/expert-application-queue", () => ({
  ExpertApplicationQueue: ({ page }: { page: number }) => <div data-testid="queue">{`${page}`}</div>,
}));
vi.mock("@/components/expert/expert-application-panel", () => ({
  ExpertApplicationPanel: () => <div data-testid="panel" />,
}));

describe("Expert pages parse the URL and hand off to client components", () => {
  it.each([
    [{}, "1"],
    [{ page: "3" }, "3"],
    [{ page: "abc" }, "1"],
    [{ page: "0" }, "1"],
    [{ page: "-2" }, "1"],
    [{ page: ["2", "5"] }, "2"],
  ])("/admin/expert-applications %j -> page %s", async (sp, expected) => {
    render(await ExpertApplicationsPage({ searchParams: Promise.resolve(sp) }));
    expect(screen.getByTestId("queue")).toHaveTextContent(expected);
    expect(screen.getByRole("heading", { level: 1, name: "Expert applications" })).toBeInTheDocument();
  });

  it("the governance page states the ADMIN/EXPERT split", async () => {
    render(await ExpertApplicationsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/administrators govern who becomes an Expert but do not review articles/i)).toBeInTheDocument();
  });

  it("/learn/expert-application renders the applicant panel under its own heading", () => {
    render(<ExpertApplicationPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Become an Expert" })).toBeInTheDocument();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
  });
});
