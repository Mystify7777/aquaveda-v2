import type { Metadata } from "next";
import Link from "next/link";

import { IssueCard } from "@/components/issues/issue-card";
import { IssueMapLoader } from "@/components/issues/issue-map-loader";
import { IssueStatusFilter } from "@/components/issues/issue-status-filter";
import { ReportIssueButton } from "@/components/issues/report-issue-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { ApiError } from "@/lib/api/client";
import { getIssues } from "@/lib/api/issues";
import { ISSUE_STATUS_LABELS, parseIssueStatus } from "@/lib/issues/status";

export const metadata: Metadata = { title: "Explore" };

function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Public Issue discovery (#50). Server-rendered from the public list read
 * (#48): `status` + pagination are the only supported query parameters, so
 * those are the only ones sent. The map plots the issues on the *current
 * page*; viewport/radius queries and search need #41 and are not faked
 * here. Anonymous-accessible; reporting stays a dialog gated by RequireAuth.
 * Loading UI: ./loading.tsx.
 */
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; status?: string | string[] }>;
}) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const status = parseIssueStatus(sp.status);
  const base = status ? `/explore?status=${status}` : "/explore";

  let result;
  try {
    result = await getIssues({ page, status });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <Shell status={status}>
        <LoadError
          message={loadErrorMessage(error, "issues")}
          retryHref={page === 1 ? base : `${base}${status ? "&" : "?"}page=${page}`}
        />
      </Shell>
    );
  }

  return (
    <Shell status={status}>
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
          <EmptyState
            title={status ? `No ${ISSUE_STATUS_LABELS[status].toLowerCase()} issues` : "No issues reported yet"}
            description={
              status
                ? "No issues currently have this status."
                : "Be the first to report a water issue in your area."
            }
          />
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
                <IssueMapLoader issues={result.items} label="Map of issues on this page" />
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
                params={status ? { status } : undefined}
              />
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ status, children }: { status?: ReturnType<typeof parseIssueStatus>; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Explore</h1>
        <ReportIssueButton />
      </div>
      <IssueStatusFilter status={status} />
      {children}
    </div>
  );
}
