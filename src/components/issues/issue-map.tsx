"use client";

import * as React from "react";
import Link from "next/link";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";

import "leaflet/dist/leaflet.css";

import type { Bbox } from "@/lib/issues/discovery";
import type { MappableIssue } from "@/lib/issues/geo";

// A divIcon avoids Leaflet's default image-marker assets, which do not
// resolve under bundlers; the dot is styled with theme tokens.
const markerIcon = L.divIcon({
  className: "",
  html: '<span class="bg-primary border-background block size-4 rounded-full border-2 shadow-md"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

/**
 * Fits the view to the active bbox when there is one (the map then shows
 * the filtered area instead of fighting it), otherwise to the markers.
 */
function FitView({ issues, bbox }: { issues: MappableIssue[]; bbox?: Bbox }) {
  const map = useMap();
  React.useEffect(() => {
    if (bbox) {
      const [west, south, east, north] = bbox;
      map.fitBounds([[south, west], [north, east]], { animate: false });
    } else if (issues.length === 1) {
      map.setView(issues[0].position, 13);
    } else if (issues.length > 1) {
      map.fitBounds(L.latLngBounds(issues.map((i) => i.position)), { padding: [32, 32], maxZoom: 15 });
    }
  }, [map, issues, bbox]);
  return null;
}

/** Reports the viewport as [w,s,e,n] (= `getBounds().toBBoxString()` order) on mount and after each move. */
function ViewportReporter({ onChange }: { onChange: (viewport: Bbox) => void }) {
  const map = useMap();
  const report = React.useCallback(() => {
    const b = map.getBounds();
    const viewport: Bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    if (viewport.every(Number.isFinite)) onChange(viewport);
  }, [map, onChange]);
  useMapEvents({ moveend: report });
  React.useEffect(report, [report]);
  return null;
}

/**
 * Leaflet map of the given issues. Client-only (loaded via IssueMapLoader
 * with ssr: false). Markers are keyboard-focusable and titled with the
 * issue title; popups link to the detail route. It only displays what it
 * is given and never fetches. Optional, for Explore's area search (#82):
 * `bbox` is the active filter area to fit; `onViewportChange` reports the
 * viewport so the caller can offer "Search this area".
 */
export default function IssueMap({
  issues,
  bbox,
  onViewportChange,
}: {
  issues: MappableIssue[];
  bbox?: Bbox;
  onViewportChange?: (viewport: Bbox) => void;
}) {
  return (
    <MapContainer
      center={bbox ? [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2] : (issues[0]?.position ?? [0, 0])}
      zoom={issues.length || bbox ? 13 : 2}
      scrollWheelZoom={false}
      className="size-full min-h-64 rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitView issues={issues} bbox={bbox} />
      {onViewportChange && <ViewportReporter onChange={onViewportChange} />}
      {issues.map((issue) => (
        <Marker key={issue.id} position={issue.position} icon={markerIcon} title={issue.title} alt={issue.title}>
          <Popup>
            <Link href={`/explore/${issue.id}`} className="font-medium underline">
              {issue.title}
            </Link>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
