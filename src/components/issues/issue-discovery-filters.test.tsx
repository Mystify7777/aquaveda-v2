import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { IssueDiscoveryFilters } from "@/components/issues/issue-discovery-filters";

describe("IssueDiscoveryFilters accessibility regression baseline", () => {
  it("exposes a labelled search region and correctly associated filter controls", () => {
    render(
      <IssueDiscoveryFilters
        filters={{}}
        invalid={{}}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Search and filter issues" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveAttribute("id", "explore-q");
    expect(screen.getByLabelText("Category")).toHaveAttribute("id", "explore-category");
    expect(screen.getByLabelText("Severity")).toHaveAttribute("id", "explore-severity");
  });

  it("announces invalid query parameters through an alert and exposes the affected input as invalid", () => {
    render(
      <IssueDiscoveryFilters
        filters={{}}
        invalid={{
          q: { problem: "Search is too short.", value: "x" },
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Search is too short.");
    expect(screen.getByLabelText("Search")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Search")).toHaveAttribute(
      "aria-describedby",
      "explore-q-hint",
    );
  });
});
