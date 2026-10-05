import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { SearchAreaControl } from "@/components/issues/issue-search-area";

describe("SearchAreaControl", () => {
  it("before the map reports a viewport: disabled, no hint", () => {
    render(<SearchAreaControl viewport={null} filters={{}} />);
    expect(screen.getByRole("button", { name: "Search this area" })).toBeDisabled();
    expect(screen.queryByText(/zoom in/i)).not.toBeInTheDocument();
  });

  it("valid viewport: a link to the canonical URL with that bbox", () => {
    render(<SearchAreaControl viewport={[77.5, 12.8, 77.7, 13.1]} filters={{}} />);
    expect(screen.getByRole("link", { name: "Search this area" })).toHaveAttribute(
      "href",
      "/explore?bbox=77.5%2C12.8%2C77.7%2C13.1",
    );
  });

  it("keeps the other filters, replaces an older bbox, and resets the page (none carried)", () => {
    render(
      <SearchAreaControl
        viewport={[1, 2, 3, 4]}
        filters={{ status: "open", category: "other", severity: "low", q: "pump", bbox: "9,9,10,10" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Search this area" })).toHaveAttribute(
      "href",
      "/explore?status=open&category=other&severity=low&q=pump&bbox=1%2C2%2C3%2C4",
    );
  });

  it("viewport above the 10 degree limit: disabled with a zoom hint, never clamped", () => {
    render(<SearchAreaControl viewport={[0, 0, 20, 5]} filters={{}} />);
    const button = screen.getByRole("button", { name: "Search this area" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/zoom in.*10°/i);
    expect(screen.queryByRole("link", { name: "Search this area" })).not.toBeInTheDocument();
  });

  it("viewport outside the world map: disabled with its own hint", () => {
    render(<SearchAreaControl viewport={[-190, 0, -185, 5]} filters={{}} />);
    expect(screen.getByRole("button", { name: "Search this area" })).toBeDisabled();
    expect(screen.getByText(/back inside the world map/i)).toBeInTheDocument();
  });
});
