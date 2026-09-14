import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import Loading from "@/app/loading";

describe("Loading (route-level loading.tsx)", () => {
  it("announces itself to assistive tech via role=status and sr-only text", () => {
    render(<Loading />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading...");
  });

  it("renders skeleton placeholders, each hidden from assistive tech", () => {
    const { container } = render(<Loading />);
    const skeletons = container.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
