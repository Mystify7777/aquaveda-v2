import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { IssueCard } from "@/components/issues/issue-card";
import { IssueDiscoveryFilters } from "@/components/issues/issue-discovery-filters";
import { IssueMapLoader } from "@/components/issues/issue-map-loader";
import { IssueStatusFilter } from "@/components/issues/issue-status-filter";
import { ReportIssueButton } from "@/components/issues/report-issue-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { ApiError } from "@/lib/api/client";
import { getIssues } from "@/lib/api/issues";
import {
  exploreHref,
  filterParams,
  hasNonCanonicalFilterParams,
  hasDiscoveryFilters,
  parseExploreQuery,
  toIssueListQuery,
  withoutDiscoveryFilters,
  type ExploreFilters,
  type ExploreQuery,
} from "@/lib/issues/discovery";
import { ISSUE_STATUS_LABELS } from "@/lib/issues/status";

export const metadata: Metadata = { title: "Explore" };

type SearchParams = { [key: string]: string | string[] | undefined };

function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Public Issue discovery (#50, #82). Server-rendered from the public list
 * read; the URL is the only filter state: `status`, `category`, `severity`,
 * `q`, `bbox` (the #41 contract, docs/architecture/issue-discovery-contract.md)
 * plus `page`, all parsed/serialized by lib/issues/discovery.ts. The map
 * plots the issues on the *current page*; with `bbox` it also fits that
 * area. Anonymous-accessible; reporting stays a dialog gated by RequireAuth.
 * Loading UI: ./loading.tsx.
 */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { filters, invalid }: ExploreQuery = parseExploreQuery(sp);
  const page = parsePage(sp.page);
  // A native GET form submits blank fields as `?q=&category=`; keep shareable URLs canonical.
  if (hasNonCanonicalFilterParams(sp)) redirect(exploreHref(filters, page));

  const base = exploreHref(filters);

  // Contract-invalid q/bbox are never sent (the API would 400) and never
  // silently dropped (results would not match the URL): say so instead.
  if (invalid.q || invalid.bbox) return <Shell filters={filters} invalid={invalid} />;

  let result;
  try {
    result = await getIssues(toIssueListQuery(filters, page));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <Shell filters={filters} invalid={invalid}>
        <LoadError message={loadErrorMessage(error, "issues")} retryHref={exploreHref(filters, page)} />
      </Shell>
    );
  }

  const params = filterParams(filters);

  return (
    <Shell filters={filters} invalid={invalid}>
      {result.items.length === 0 ? (
        result.total > 0 ? (
          <EmptyState
            title="No issues on this page"
            description="This page is past the last page of issues."
            action={
              <Button asChild variant="outline">
                <Link href={base}>Back to first page</Link>
              </Button>
            }
          />
        ) : (
          <NoResults filters={filters} />
        )
      ) : (
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {result.total} {result.total === 1 ? "issue" : "issues"} · page {result.page} of {result.totalPages}.
            The map shows the issues on this page.
          </p>
          {/*
            DOM order is skip link -> map -> list -> pagination, so the skip link
            genuinely bypasses the focusable map markers. On lg the grid places
            the list in column 1 and the map in column 2 (visual: list | map)
            without reordering the DOM; below lg they stack in DOM order.
          */}
          <a
            href="#issue-list"
            className="bg-background focus:ring-ring sr-only rounded-md px-3 py-2 text-sm focus:not-sr-only focus:ring-2"
          >
            Skip map to issue list
          </a>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="lg:col-start-2 lg:row-start-1">
              <div className="lg:sticky lg:top-20">
                <IssueMapLoader issues={result.items} label="Map of issues on this page" areaSearch={{ filters }} />
              </div>
            </div>
            <div className="space-y-4 lg:col-start-1 lg:row-start-1">
              <h2 id="issue-list-heading" className="sr-only">
                Issues
              </h2>
              <ul id="issue-list" aria-labelledby="issue-list-heading" className="space-y-4">
                {result.items.map((issue) => (
                  <li key={issue._id}>
                    <IssueCard issue={issue} />
                  </li>
                ))}
              </ul>
              <PaginationNav
                page={result.page}
                totalPages={result.totalPages}
                basePath="/explore"
                label="Issue pages"
                params={Object.keys(params).length ? params : undefined}
              />
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** Empty result for page 1: status-only keeps the original copy; any discovery filter says so and offers a way out. */
function NoResults({ filters }: { filters: ExploreFilters }) {
  if (hasDiscoveryFilters(filters)) {
    return (
      <EmptyState
        title="No issues match these filters"
        description="Try fewer or different filters, or search a different map area."
        action={
          <Button asChild variant="outline">
            <Link href={exploreHref(withoutDiscoveryFilters(filters))}>Clear filters</Link>
          </Button>
        }
      />
    );
  }
  const { status } = filters;
  return (
    <EmptyState
      title={status ? `No ${ISSUE_STATUS_LABELS[status].toLowerCase()} issues` : "No issues reported yet"}
      description={
        status ? "No issues currently have this status." : "Be the first to report a water issue in your area."
      }
    />
  );
}

function Shell({
  filters,
  invalid,
  children,
}: {
  filters: ExploreFilters;
  invalid: ExploreQuery["invalid"];
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Explore</h1>
        <ReportIssueButton />
      </div>
      <IssueStatusFilter filters={filters} />
      <IssueDiscoveryFilters filters={filters} invalid={invalid} />
      {children}
    </div>
  );
}
