import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Footer } from "@/components/layout/footer";

describe("Footer", () => {
  it("renders the expected static copy", () => {
    render(<Footer />);
    expect(screen.getByText("AquaVeda, reconstruction in progress")).toBeInTheDocument();
    expect(screen.getByText("Water is the flagship domain, not the ceiling.")).toBeInTheDocument();
  });
});
