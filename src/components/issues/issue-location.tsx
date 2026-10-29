import { MapPin } from "lucide-react";

import type { Issue } from "@/lib/api/types/issue";
import { normalizeLocationLabel } from "@/lib/issues/location-contract";

export const LOCATION_FALLBACK_TEXT = "Location not named";

/**
 * The reporter-supplied place name, or null. Untrusted display text: it is
 * re-normalized here (strips bidi/zero-width/control characters even for
 * records that predate or bypassed validation) and only ever rendered as a
 * React text node. It never feeds the map, filters or any decision.
 */
export function readableLocation(issue: Pick<Issue, "locationLabel">): string | null {
  return normalizeLocationLabel(issue.locationLabel) ?? null;
}

/** Compact location line for list cards; always present so cards stay uniform. */
export function IssueCardLocation({ issue }: { issue: Pick<Issue, "locationLabel"> }) {
  const label = readableLocation(issue);
  return (
    <p className="text-muted-foreground flex items-start gap-1 text-xs">
      <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="sr-only">Location: </span>
      <span dir="auto" className={label ? "break-words" : "italic"}>
        {label ?? LOCATION_FALLBACK_TEXT}
      </span>
    </p>
  );
}
