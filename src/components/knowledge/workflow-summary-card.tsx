import Link from "next/link";

import { WorkflowStatusBadge } from "@/components/knowledge/workflow-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";
import type { WorkflowKnowledgeSummary } from "@/lib/api/types/knowledge";

export function WorkflowSummaryCard({
  item,
  showAuthor,
}: {
  item: WorkflowKnowledgeSummary;
  showAuthor?: boolean;
}) {
  return (
    <Card className="hover:border-foreground/30 focus-within:border-foreground/30 transition-colors">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="text-base">
          <Link
            href={`/protected/learn/review/${item._id}`}
            className="focus-visible:ring-ring rounded-sm outline-none focus-visible:ring-2"
          >
            {item.title}
          </Link>
        </CardTitle>
        <WorkflowStatusBadge status={item.status} />
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-xs">
          {showAuthor && item.author ? `By ${item.author.name} · ` : ""}
          Updated <time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
        </p>
      </CardContent>
    </Card>
  );
}
