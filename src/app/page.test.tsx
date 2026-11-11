import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import HomePage from "@/app/page";

vi.mock("@/components/landing/landing-map-preview", () => ({
  LandingMapPreview: () => <div role="region" aria-label="Public map preview" />,
}));

vi.mock("@/components/issues/report-issue-button", () => ({
  ReportIssueButton: () => <button>Report an issue</button>,
}));

describe("/", () => {
  it("presents AquaVeda as a product rather than a development-status page", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Understand what is happening. Help decide what happens next.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/foundation slice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/being rebuilt/i)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Public map preview" })).toBeInTheDocument();
  });

  it("provides anonymous entry points into the implemented product", () => {
    render(<HomePage />);

    expect(screen.getByRole("link", { name: "Explore what is happening" })).toHaveAttribute("href", "/explore");
    expect(screen.getByRole("link", { name: "Learn how AquaVeda works" })).toHaveAttribute("href", "/learn");
  });

  it("communicates the product loop and trust model", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "From a signal on the map to something people can act on." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Useful information needs more than an answer box." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Not everyone has the same job here." })).toBeInTheDocument();
    expect(screen.getByText("Community contributes")).toBeInTheDocument();
    expect(screen.getByText("Experts verify")).toBeInTheDocument();
    expect(screen.getByText("AI assists")).toBeInTheDocument();
  });

  it("keeps the contribution entry point visible", () => {
    render(<HomePage />);

    expect(screen.getByRole("button", { name: "Report an issue" })).toBeInTheDocument();
  });
});
