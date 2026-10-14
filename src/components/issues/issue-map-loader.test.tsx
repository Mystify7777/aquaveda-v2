import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IssueMapLoader } from "@/components/issues/issue-map-loader";
import type { Issue } from "@/lib/api/types/issue";

// Leaflet itself is exercised in issue-map.test.tsx; here only the loader contract.
vi.mock("@/components/issues/issue-map", () => ({
  default: ({
    issues,
    bbox,
    onViewportChange,
  }: {
    issues: { id: string }[];
    bbox?: number[];
    onViewportChange?: (v: [number, number, number, number]) => void;
  }) => (
    <div data-testid="map" data-bbox={bbox?.join(",")} data-reports={onViewportChange ? "yes" : "no"}>
      {issues.map((i) => i.id).join(",")}
      <button onClick={() => onViewportChange?.([77.5, 12.8, 77.7, 13.1])}>pan</button>
    </div>
  ),
}));

const issue = (id: string, coordinates: [number, number]) =>
  ({ _id: id, title: id, location: { type: "Point", coordinates } }) as unknown as Issue;

describe("IssueMapLoader", () => {
  it("renders a labelled region with only the mappable issues", async () => {
    render(<IssueMapLoader label="Map of issues" issues={[issue("a", [77, 12]), issue("bad", [999, 0]), issue("b", [78, 13])]} />);
    expect(screen.getByRole("region", { name: "Map of issues" })).toBeInTheDocument();
    expect(await screen.findByTestId("map")).toHaveTextContent("a,b");
  });

  it("renders nothing at all when no issue has usable coordinates", () => {
    const { container } = render(<IssueMapLoader label="Map" issues={[issue("bad", [999, 0])]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<IssueMapLoader label="Map" issues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("areaSearch (Explore, #82)", () => {
    const filters = { category: "other", q: "pump" } as const;

    it("without areaSearch there is no control and the map does not report a viewport (detail page unchanged)", async () => {
      render(<IssueMapLoader label="Map" issues={[issue("a", [77, 12])]} />);
      expect(await screen.findByTestId("map")).toHaveAttribute("data-reports", "no");
      expect(screen.queryByRole("button", { name: "Search this area" })).not.toBeInTheDocument();
    });

    it("offers a disabled control until the map reports, then a link carrying the filters", async () => {
      render(<IssueMapLoader label="Map" issues={[issue("a", [77, 12])]} areaSearch={{ filters }} />);
      expect(screen.getByRole("button", { name: "Search this area" })).toBeDisabled();
      await userEvent.setup().click(await screen.findByRole("button", { name: "pan" }));
      expect(screen.getByRole("link", { name: "Search this area" })).toHaveAttribute(
        "href",
        "/explore?category=other&q=pump&bbox=77.5%2C12.8%2C77.7%2C13.1",
      );
    });

    it("an active bbox is passed to the map as bounds", async () => {
      render(<IssueMapLoader label="Map" issues={[issue("a", [77.6, 13])]} areaSearch={{ filters: { bbox: "77.5,12.8,77.7,13.1" } }} />);
      expect(await screen.findByTestId("map")).toHaveAttribute("data-bbox", "77.5,12.8,77.7,13.1");
    });

    it("an active bbox keeps the map (and control) even with zero issues, so the user can move on", async () => {
      render(<IssueMapLoader label="Map" issues={[]} areaSearch={{ filters: { bbox: "77.5,12.8,77.7,13.1" } }} />);
      expect(screen.getByRole("region", { name: "Map" })).toBeInTheDocument();
      expect(await screen.findByTestId("map")).toBeInTheDocument();
    });

    it("no bbox and no issues still renders nothing", () => {
      const { container } = render(<IssueMapLoader label="Map" issues={[]} areaSearch={{ filters }} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
