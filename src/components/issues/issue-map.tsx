"use client";

import * as React from "react";
import Link from "next/link";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

import "leaflet/dist/leaflet.css";

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

function FitToMarkers({ issues }: { issues: MappableIssue[] }) {
  const map = useMap();
  React.useEffect(() => {
    if (issues.length === 1) {
      map.setView(issues[0].position, 13);
    } else if (issues.length > 1) {
      map.fitBounds(L.latLngBounds(issues.map((i) => i.position)), { padding: [32, 32], maxZoom: 15 });
    }
  }, [map, issues]);
  return null;
}

/**
 * Leaflet map of the given issues. Client-only (loaded via IssueMapLoader
 * with ssr: false). Markers are keyboard-focusable and titled with the
 * issue title; popups link to the detail route. It only displays what it
 * is given — there is no viewport-driven fetching yet (the `bbox` contract exists since #41; adoption is a follow-up).
 */
export default function IssueMap({ issues }: { issues: MappableIssue[] }) {
  return (
    <MapContainer
      center={issues[0]?.position ?? [0, 0]}
      zoom={issues.length ? 13 : 2}
      scrollWheelZoom={false}
      className="size-full min-h-64 rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToMarkers issues={issues} />
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
