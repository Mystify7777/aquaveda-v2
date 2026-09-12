import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>operational</Badge>);
    expect(screen.getByText("operational")).toBeInTheDocument();
  });

  it("applies the default variant's classes when none are given", () => {
    render(<Badge>default</Badge>);
    expect(screen.getByText("default").className).toContain("bg-primary");
  });

  it("applies the requested variant's classes", () => {
    render(<Badge variant="critical">critical</Badge>);
    expect(screen.getByText("critical").className).toContain("bg-destructive");
  });

  it("merges a caller-supplied className with the variant's classes rather than replacing them", () => {
    render(
      <Badge variant="verified" className="my-custom-class">
        verified
      </Badge>,
    );
    const el = screen.getByText("verified");
    expect(el.className).toContain("bg-accent");
    expect(el.className).toContain("my-custom-class");
  });
});
