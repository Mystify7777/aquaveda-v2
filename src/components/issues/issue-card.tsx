import Link from "next/link";

import { IssueStatusBadge } from "@/components/issues/issue-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";
import type { Issue } from "@/lib/api/types/issue";
import { categoryLabel, severityLabel } from "@/lib/issues/labels";

export function IssueCard({ issue }: { issue: Issue }) {
  const meta = [categoryLabel(issue.category), severityLabel(issue.severity)].filter(Boolean);
  return (
    <Card className="hover:border-foreground/30 focus-within:border-foreground/30 transition-colors">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="text-base">
          <Link
            href={`/explore/${issue._id}`}
            className="focus-visible:ring-ring rounded-sm outline-none focus-visible:ring-2"
          >
            {issue.title}
          </Link>
        </CardTitle>
        <IssueStatusBadge status={issue.status} />
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-muted-foreground line-clamp-2 text-sm">{issue.description}</p>
        <p className="text-muted-foreground text-xs">
          {meta.length > 0 && `${meta.join(" · ")} · `}
          Reported by {issue.reportedBy.name} ·{" "}
          <time dateTime={issue.createdAt}>{formatDate(issue.createdAt)}</time>
        </p>
      </CardContent>
    </Card>
  );
}
