import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { IssueMapLoader } from "@/components/issues/issue-map-loader";
import type { Issue } from "@/lib/api/types/issue";

// Leaflet itself is exercised in issue-map.test.tsx; here only the loader contract.
vi.mock("@/components/issues/issue-map", () => ({
  default: ({ issues }: { issues: { id: string }[] }) => <div data-testid="map">{issues.map((i) => i.id).join(",")}</div>,
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
});
