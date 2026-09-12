import { describe, it, expect } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins multiple class strings", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("resolves conflicting Tailwind utility classes to the last one (tailwind-merge behavior)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("preserves non-conflicting classes alongside a resolved conflict", () => {
    expect(cn("text-sm px-2", "px-4")).toBe("text-sm px-4");
  });
});
