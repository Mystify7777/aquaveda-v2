"use client";

import * as React from "react";
import dynamic from "next/dynamic";

import { SearchAreaControl } from "@/components/issues/issue-search-area";
import { Skeleton } from "@/components/ui/skeleton";
import { bboxToBounds, type Bbox, type ExploreFilters } from "@/lib/issues/discovery";
import { toMappableIssues } from "@/lib/issues/geo";
import type { Issue } from "@/lib/api/types/issue";

const IssueMap = dynamic(() => import("@/components/issues/issue-map"), {
  ssr: false,
  loading: () => (
    <div role="status" className="size-full min-h-64">
      <span className="sr-only">Loading map...</span>
      <Skeleton className="size-full min-h-64 rounded-lg" />
    </div>
  ),
});

/**
 * Lazy boundary for the map: Leaflet needs `window`, and keeping it out of
 * the initial bundle matters because the list is usable without it.
 * Issues with no usable coordinates are skipped; if none remain the map
 * is not rendered at all — except in Explore's area search (`areaSearch`),
 * where an active bbox keeps the map so the user can move on from an empty area.
 */
export function IssueMapLoader({
  issues,
  label,
  heightClassName = "h-72 lg:h-[32rem]",
  areaSearch,
}: {
  issues: Issue[];
  /** Accessible name of the map region. */
  label: string;
  heightClassName?: string;
  /** Explore only: adds "Search this area", carrying the other active filters. */
  areaSearch?: { filters: ExploreFilters };
}) {
  const [viewport, setViewport] = React.useState<Bbox | null>(null);
  const mappable = toMappableIssues(issues);
  const bounds = bboxToBounds(areaSearch?.filters.bbox) ?? undefined;
  if (mappable.length === 0 && !bounds) return null;

  const map = (
    <div role="region" aria-label={label} className={`${heightClassName} overflow-hidden rounded-lg border`}>
      <IssueMap issues={mappable} bbox={bounds} onViewportChange={areaSearch ? setViewport : undefined} />
    </div>
  );
  if (!areaSearch) return map;
  return (
    <div className="space-y-2">
      {map}
      <SearchAreaControl viewport={viewport} filters={areaSearch.filters} />
    </div>
  );
}
