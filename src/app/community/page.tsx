import type { Metadata } from "next";
import Link from "next/link";

import { getCommunityActivity } from "@/lib/api/community";
import type { CommunityActivityType } from "@/lib/api/types/community";
import { ApiError } from "@/lib/api/client";
import { formatDate } from "@/lib/format-date";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Community" };

type SearchParams = { page?: string | string[]; type?: string | string[] };

const FILTERS: Array<{ value: "ALL" | CommunityActivityType; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "DISCUSSION", label: "Discussions" },
  { value: "ISSUE", label: "Issues" },
  { value: "KNOWLEDGE", label: "Knowledge" },
];

function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function parseType(raw: string | string[] | undefined): "ALL" | CommunityActivityType {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return FILTERS.some((filter) => filter.value === value)
    ? (value as "ALL" | CommunityActivityType)
    : "ALL";
}

function typeLabel(type: CommunityActivityType): string {
  if (type === "DISCUSSION") return "Discussion";
  if (type === "KNOWLEDGE") return "Knowledge";
  return "Issue";
}

function activityHref(type: CommunityActivityType, id: string): string {
  if (type === "DISCUSSION") return "/community/discussions/" + encodeURIComponent(id);
  if (type === "KNOWLEDGE") return "/learn/" + encodeURIComponent(id);
  return "/explore/" + encodeURIComponent(id);
}

function filterHref(type: "ALL" | CommunityActivityType): string {
  if (type === "ALL") return "/community";
  return "/community?type=" + type;
}

export default async function CommunityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const type = parseType(params.type);

  let result;
  try {
    result = await getCommunityActivity({ page, limit: 50 });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return <Shell><LoadError message={loadErrorMessage(error, "community activity")} retryHref="/community" /></Shell>;
  }

  const items = type === "ALL" ? result.items : result.items.filter((item) => item.type === type);

  return (
    <Shell>
      <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl space-y-2">
          <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">Community</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">What people are discussing</h1>
          <p className="text-muted-foreground text-sm leading-6">Follow recent conversation across Discussions, reported Issues, and reviewed Knowledge.</p>
        </div>
        <Button asChild><Link href="/community/discussions/new">Start a discussion</Link></Button>
      </header>

      <nav aria-label="Community activity filters" className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Button key={filter.value} asChild variant={type === filter.value ? "default" : "outline"} size="sm">
            <Link href={filterHref(filter.value)} aria-current={type === filter.value ? "page" : undefined}>{filter.label}</Link>
          </Button>
        ))}
      </nav>

      {type !== "ALL" && <p className="text-muted-foreground -mt-2 text-xs">Showing {typeLabel(type)} activity from the currently loaded activity page.</p>}

      {items.length === 0 ? (
        <EmptyState
          title={type === "ALL" ? "No community activity yet" : "No " + typeLabel(type).toLowerCase() + " activity on this page"}
          description={type === "ALL" ? "New public conversation will appear here as activity is recorded." : "Try another filter or move to another activity page."}
          action={type !== "ALL" ? <Button asChild variant="outline"><Link href="/community">Show all activity</Link></Button> : undefined}
        />
      ) : (
        <>
          <ul className="grid gap-4">
            {items.map((item) => (
              <li key={item.id}>
                <Card className="transition-colors hover:border-foreground/30">
                  <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                    <div className="space-y-1">
                      <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">{typeLabel(item.type)}</p>
                      <CardTitle className="text-base">
                        <Link href={activityHref(item.type, item.resource.id)} className="focus-visible:ring-ring rounded-sm outline-none focus-visible:ring-2">{item.title}</Link>
                      </CardTitle>
                    </div>
                    <time dateTime={item.activityAt} className="text-muted-foreground shrink-0 text-xs">{formatDate(item.activityAt)}</time>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-xs">
                      {item.author ? "By " + item.author.name : "Author unavailable"}{" · "}
                      {item.commentCount} {item.commentCount === 1 ? "comment" : "comments"}
                      {item.category ? " · " + item.category : ""}
                    </p>
                    <Link href={activityHref(item.type, item.resource.id)} className="text-sm font-medium underline-offset-4 hover:underline">Open {typeLabel(item.type).toLowerCase()}</Link>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <PaginationNav page={result.page} totalPages={result.totalPages} basePath="/community" label="Community activity pages" params={type !== "ALL" ? { type } : undefined} />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-16 sm:px-6">{children}</div>;
}