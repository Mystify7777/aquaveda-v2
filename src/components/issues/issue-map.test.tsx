import L from "leaflet";
import { describe, it, expect, vi, afterEach } from "vitest";
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

  describe("area search hooks (#82)", () => {
    afterEach(() => vi.restoreAllMocks());
    const wrap = (node: React.ReactNode) => render(<div style={{ height: 300, width: 300 }}>{node}</div>);

    it("fits the active bbox (not the markers) and does not animate", () => {
      const fit = vi.spyOn(L.Map.prototype, "fitBounds");
      const set = vi.spyOn(L.Map.prototype, "setView");
      wrap(<IssueMap issues={[{ id: "1", title: "A", position: [12.9, 77.6] }]} bbox={[77.5, 12.8, 77.7, 13.1]} />);
      expect(fit).toHaveBeenCalledWith([[12.8, 77.5], [13.1, 77.7]], expect.objectContaining({ animate: false }));
      expect(set).not.toHaveBeenCalledWith([12.9, 77.6], 13);
    });

    it("without bbox the original marker fit is unchanged", () => {
      const set = vi.spyOn(L.Map.prototype, "setView");
      wrap(<IssueMap issues={[{ id: "1", title: "A", position: [12.9, 77.6] }]} />);
      expect(set).toHaveBeenCalledWith([12.9, 77.6], 13);
    });

    it("reports the viewport as [west, south, east, north] on mount", () => {
      const onViewportChange = vi.fn();
      vi.spyOn(L.Map.prototype, "getBounds").mockReturnValue(L.latLngBounds([12.8, 77.5], [13.1, 77.7]));
      wrap(<IssueMap issues={[{ id: "1", title: "A", position: [12.9, 77.6] }]} onViewportChange={onViewportChange} />);
      expect(onViewportChange).toHaveBeenCalledWith([77.5, 12.8, 77.7, 13.1]);
    });

    it("lifecycle: an active bbox is fitted first, and the viewport reported is the post-fit one", () => {
      let fitted = false;
      const pre = L.latLngBounds([0, 0], [1, 1]);
      const post = L.latLngBounds([12.8, 77.5], [13.1, 77.7]);
      const order: string[] = [];
      vi.spyOn(L.Map.prototype, "fitBounds").mockImplementation(function (this: L.Map) {
        fitted = true;
        order.push("fit");
        return this;
      });
      vi.spyOn(L.Map.prototype, "getBounds").mockImplementation(() => {
        order.push("report-source");
        return fitted ? post : pre;
      });
      const onViewportChange = vi.fn();
      wrap(
        <IssueMap
          issues={[{ id: "1", title: "A", position: [12.9, 77.6] }]}
          bbox={[77.5, 12.8, 77.7, 13.1]}
          onViewportChange={onViewportChange}
        />,
      );
      expect(order[0]).toBe("fit");
      expect(onViewportChange).toHaveBeenCalled();
      expect(onViewportChange.mock.calls[0][0]).toEqual([77.5, 12.8, 77.7, 13.1]);
      expect(onViewportChange.mock.calls.every(([v]) => v[0] === 77.5)).toBe(true); // never the pre-fit [0,0,1,1]
    });

    it("does not report when no callback is given", () => {
      const get = vi.spyOn(L.Map.prototype, "getBounds");
      wrap(<IssueMap issues={[{ id: "1", title: "A", position: [12.9, 77.6] }]} />);
      expect(get).not.toHaveBeenCalled();
    });
  });
});
