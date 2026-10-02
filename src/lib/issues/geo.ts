import type { Issue } from "@/lib/api/types/issue";

export type LatLng = [lat: number, lng: number];

/**
 * GeoJSON stores [longitude, latitude]; Leaflet wants [lat, lng]. Returns
 * null for anything that is not a finite in-range coordinate pair, so a
 * malformed record is skipped on the map instead of breaking it.
 */
export function toLatLng(location: Issue["location"] | undefined): LatLng | null {
  const c = location?.coordinates;
  if (!Array.isArray(c) || c.length !== 2) return null;
  const [lng, lat] = c;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

export interface MappableIssue {
  id: string;
  title: string;
  position: LatLng;
}

export function toMappableIssues(issues: Issue[]): MappableIssue[] {
  return issues.flatMap((issue) => {
    const position = toLatLng(issue.location);
    return position ? [{ id: issue._id, title: issue.title, position }] : [];
  });
}
