import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { EmptyState } from "@/components/ui/empty-state";

describe("EmptyState", () => {
  it("renders the title and description", () => {
    render(<EmptyState title="Nothing here" description="Check back later." />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Check back later.")).toBeInTheDocument();
  });

  it("does not render an action wrapper when no action is given", () => {
    const { container } = render(
      <EmptyState title="Nothing here" description="Check back later." />,
    );
    // The action is only ever wrapped when provided — absence must not
    // leave a stray empty wrapper in the DOM.
    expect(container.querySelector(".pt-1")).not.toBeInTheDocument();
  });

  it("renders the provided action", () => {
    render(
      <EmptyState
        title="Nothing here"
        description="Check back later."
        action={<button>Retry</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
