import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import IssueDetailLoading from "@/app/explore/[issueId]/loading";

describe("Issue detail loading state", () => {
  it("announces loading for the issue (not the list) and renders skeleton structure", () => {
    const { container } = render(<IssueDetailLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading issue...");
    expect(screen.queryByText(/Loading issues/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('[class*="animate-pulse"], [data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
