import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { Skeleton } from "@/components/ui/skeleton";

describe("Skeleton", () => {
  it("is hidden from assistive tech (aria-hidden=true)", () => {
    const { container } = render(<Skeleton data-testid="skel" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("always renders aria-hidden=true even if a caller tries to override it", () => {
    // The component spreads {...props} before its own aria-hidden
    // attribute, so a caller-supplied override can never win — a
    // Skeleton must never be exposed to assistive tech by mistake.
    // (aria-hidden's type permits the string "false" — this is a
    // runtime override attempt, not a type-checking concern, so no
    // suppression comment is needed here.)
    const { container } = render(<Skeleton aria-hidden="false" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("merges a caller-supplied className with its own base classes", () => {
    const { container } = render(<Skeleton className="h-10 w-10" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("h-10");
    expect(el.className).toContain("w-10");
  });
});
