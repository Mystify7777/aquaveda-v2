import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { IssueStatus } from "@/lib/api/types/issue";
import { ISSUE_STATUSES, ISSUE_STATUS_LABELS } from "@/lib/issues/status";

/**
 * Status filter as plain links (URL-driven, works without JS). `status` is
 * the only filter the backend list contract supports (#48); category,
 * severity, text and location filters exist since #41 (see docs/architecture/issue-discovery-contract.md) but this component does not offer them yet.
 */
export function IssueStatusFilter({ status }: { status?: IssueStatus }) {
  return (
    <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
      {[undefined, ...ISSUE_STATUSES].map((s) => (
        <Button key={s ?? "all"} asChild size="sm" variant={s === status ? "default" : "outline"}>
          <Link href={s ? `/explore?status=${s}` : "/explore"} aria-current={s === status ? "page" : undefined}>
            {s ? ISSUE_STATUS_LABELS[s] : "All"}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
