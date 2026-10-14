import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ISSUE_STATUSES, ISSUE_STATUS_LABELS } from "@/lib/issues/status";
import { exploreHref, type ExploreFilters } from "@/lib/issues/discovery";

/**
 * Status filter as plain links (URL-driven, works without JS). Changing
 * status keeps every other active filter and resets pagination, so each
 * link is the canonical URL of the resulting state (see lib/issues/discovery.ts).
 */
export function IssueStatusFilter({ filters }: { filters: ExploreFilters }) {
  return (
    <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
      {[undefined, ...ISSUE_STATUSES].map((s) => (
        <Button key={s ?? "all"} asChild size="sm" variant={s === filters.status ? "default" : "outline"}>
          <Link href={exploreHref({ ...filters, status: s })} aria-current={s === filters.status ? "page" : undefined}>
            {s ? ISSUE_STATUS_LABELS[s] : "All"}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
