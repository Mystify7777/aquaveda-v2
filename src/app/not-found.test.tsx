import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import NotFound from "@/app/not-found";

describe("NotFound (route-level not-found.tsx)", () => {
  it("renders a heading indicating the page was not found", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("renders a link back to home", () => {
    render(<NotFound />);
    const homeLink = screen.getByRole("link", { name: "Back to home" });
    expect(homeLink).toHaveAttribute("href", "/");
  });
});
