"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
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
 * is not rendered at all.
 */
export function IssueMapLoader({
  issues,
  label,
  heightClassName = "h-72 lg:h-[32rem]",
}: {
  issues: Issue[];
  /** Accessible name of the map region. */
  label: string;
  heightClassName?: string;
}) {
  const mappable = toMappableIssues(issues);
  if (mappable.length === 0) return null;
  return (
    <div role="region" aria-label={label} className={`${heightClassName} overflow-hidden rounded-lg border`}>
      <IssueMap issues={mappable} />
    </div>
  );
}
