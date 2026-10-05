import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  BBOX_MAX_SPAN_DEGREES,
  exploreHref,
  viewportToBbox,
  type Bbox,
  type ExploreFilters,
} from "@/lib/issues/discovery";

/**
 * "Search this area": applies the map's current viewport as the contract
 * `bbox` (#41). Explicit, never automatic (no refetch on every pan, no
 * map<->URL feedback loop). It is a plain link to the canonical URL, so
 * other filters are kept and pagination resets. A viewport the API would
 * reject is explained and disabled, never clamped.
 */
export function SearchAreaControl({ viewport, filters }: { viewport: Bbox | null; filters: ExploreFilters }) {
  const result = viewport ? viewportToBbox(viewport) : null;

  if (result?.ok) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={exploreHref({ ...filters, bbox: result.bbox })}>Search this area</Link>
      </Button>
    );
  }

  const hint = !result
    ? null
    : result.reason === "too-large"
      ? `Zoom in to search this area (at most ${BBOX_MAX_SPAN_DEGREES}° wide and tall).`
      : "Move the map back inside the world map to search this area.";

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" disabled aria-describedby={hint ? "search-area-hint" : undefined}>
        Search this area
      </Button>
      {hint && (
        <p id="search-area-hint" className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}
