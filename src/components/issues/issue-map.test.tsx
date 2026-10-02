import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import IssueMap from "@/components/issues/issue-map";

// Real Leaflet/react-leaflet in jsdom (no tile network assertions).
describe("IssueMap (real Leaflet)", () => {
  it("renders one keyboard-focusable, titled marker per issue", () => {
    render(
      <div style={{ height: 300, width: 300 }}>
        <IssueMap
          issues={[
            { id: "1", title: "Leak on Main St", position: [12.9, 77.5] },
            { id: "2", title: "Dry well", position: [13.0, 77.6] },
          ]}
        />
      </div>,
    );
    const a = screen.getByTitle("Leak on Main St");
    const b = screen.getByTitle("Dry well");
    expect(a).toHaveAttribute("tabindex", "0");
    expect(b).toHaveAttribute("role", "button");
  });

  it("renders attribution for the tile source", () => {
    render(
      <div style={{ height: 300, width: 300 }}>
        <IssueMap issues={[{ id: "1", title: "X", position: [1, 2] }]} />
      </div>,
    );
    expect(screen.getByText("OpenStreetMap")).toBeInTheDocument();
  });
});
