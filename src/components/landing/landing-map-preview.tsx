"use client";

import * as React from "react";

import { IssueMapLoader } from "@/components/issues/issue-map-loader";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { getIssues } from "@/lib/api/issues";
import { ApiError } from "@/lib/api/client";
import type { Issue } from "@/lib/api/types/issue";

const PREVIEW_LIMIT = 8;

export function LandingMapPreview() {
  const [issues, setIssues] = React.useState<Issue[] | null>(null);
  const [error, setError] = React.useState<ApiError | null>(null);

  React.useEffect(() => {
    let active = true;

    async function loadIssues() {
      try {
        const result = await getIssues({ page: 1, limit: PREVIEW_LIMIT });
        if (active) setIssues(result.items);
      } catch (reason: unknown) {
        if (active) {
          setError(reason instanceof ApiError ? reason : new ApiError("Could not load issues", "network"));
        }
      }
    }

    void loadIssues();

    return () => {
      active = false;
    };
  }, []);

  let mapContent: React.ReactNode;
  if (issues === null && !error) {
    mapContent = <MapLoading />;
  } else if (error) {
    mapContent = (
      <div className="flex min-h-72 flex-col justify-between p-5">
        <div className="space-y-2">
          <p className="font-display text-base font-semibold">The public map is taking a moment.</p>
          <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
            The landing page stays usable even when the issue service is unavailable. Explore remains the source
            of truth for the full public view.
          </p>
        </div>
        <LoadError message={loadErrorMessage(error, "issues")} retryHref="/explore" />
      </div>
    );
  } else if (issues === null || issues.length === 0) {
    mapContent = <MapEmpty />;
  } else {
    mapContent = (
      <IssueMapLoader
        issues={issues}
        label="Public map preview showing reported issues"
        heightClassName="h-72 sm:h-[24rem]"
      />
    );
  }

  return (
    <section aria-labelledby="map-preview-heading" className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-5">
        <div>
          <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            Public issue map
          </p>
          <h2 id="map-preview-heading" className="font-display text-sm font-semibold">
            See what is happening
          </h2>
        </div>
        <span className="text-muted-foreground font-mono text-[10px]">PUBLIC ISSUE DATA</span>
      </div>

      <div className="min-h-72">{mapContent}</div>

      <div className="border-t px-4 py-3 sm:px-5">
        <p className="text-muted-foreground text-xs">
          Reports shown here are public community reports. Verification and knowledge have their own paths.
        </p>
      </div>
    </section>
  );
}

function MapLoading() {
  return (
    <div role="status" className="flex min-h-72 flex-col justify-between p-5">
      <div className="space-y-3">
        <div className="bg-muted h-3 w-24 animate-pulse rounded" />
        <div className="bg-muted h-7 max-w-sm animate-pulse rounded" />
      </div>
      <p className="text-muted-foreground text-xs">Loading public issue locations…</p>
    </div>
  );
}

function MapEmpty() {
  return (
    <div className="relative flex min-h-72 items-end overflow-hidden p-5">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(to right, transparent 49.5%, var(--color-contour) 50%, transparent 50.5%), linear-gradient(to bottom, transparent 49.5%, var(--color-contour) 50%, transparent 50.5%)",
          backgroundSize: "72px 72px",
        }}
      />
      <div className="relative max-w-sm space-y-2">
        <p className="font-display text-base font-semibold">No public issues to plot yet.</p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          The map will show reported locations as public issues are added. Nothing has been invented to make the
          screen look busier.
        </p>
      </div>
    </div>
  );
}
