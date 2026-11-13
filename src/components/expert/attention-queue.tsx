"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { getIssueAttentionQueue } from "@/lib/api/issue-attention";
import { useApiResource } from "@/lib/api/use-api-resource";
import type { AttentionQueue, AttentionQueueItem } from "@/lib/api/types/issue-attention";
import { ATTENTION_QUEUES } from "@/lib/api/types/issue-attention";
import { ISSUE_STATUS_LABELS } from "@/lib/issues/status";
import { formatDateTime } from "@/lib/format-date";

const PAGE_SIZE = 20;

const QUEUE_META: Record<AttentionQueue, { label: string; description: string }> = {
  unacknowledged: {
    label: "Unacknowledged",
    description: "Open issues waiting for an expert acknowledgement.",
  },
  unassigned: {
    label: "Unassigned",
    description: "Acknowledged or active issues without an accepted responsible party.",
  },
  awaiting_verification: {
    label: "Awaiting verification",
    description: "Resolved issues waiting for independent verification.",
  },
};

function parsePage(raw: string | null): number {
  const page = Number(raw ?? "1");
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function QueueSkeleton() {
  return (
    <div role="status" className="grid gap-3">
      <span className="sr-only">Loading attention queue...</span>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  );
}

function AttentionItem({ item }: { item: AttentionQueueItem }) {
  return (
    <Card>
      <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base leading-snug">
            <Link
              href={`/explore/${encodeURIComponent(item._id)}`}
              className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.title}
            </Link>
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            {item.category ? item.category.replaceAll("_", " ") : "Unclassified issue"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{ISSUE_STATUS_LABELS[item.status]}</Badge>
          {item.severity && (
            <Badge
              variant={
                item.severity === "critical"
                  ? "critical"
                  : item.severity === "high"
                    ? "warning"
                    : "outline"
              }
            >
              {item.severity}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {item.waitingSince ? (
            <>
              Waiting since{" "}
              <time dateTime={item.waitingSince}>{formatDateTime(item.waitingSince)}</time>
            </>
          ) : (
            "Waiting time unavailable"
          )}
        </p>
        <span className="text-muted-foreground text-xs">
          Responsibility:{" "}
          {item.responsibility === "none"
            ? "None accepted"
            : item.responsibility === "pending"
              ? "Offer pending"
              : "Accepted"}
        </span>
      </CardContent>
    </Card>
  );
}

/**
 * Authenticated EXPERT read-only triage surface. Queue membership, item order,
 * waiting timestamps and pagination all come from the API; this component only
 * selects a queue and renders the allowlisted DTO. No workflow mutations.
 */
export function AttentionQueue() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedQueue = searchParams.get("queue");
  const queue: AttentionQueue =
    ATTENTION_QUEUES.find((candidate) => candidate === requestedQueue) ?? "unacknowledged";
  const page = parsePage(searchParams.get("page"));

  const { resource, reload } = useApiResource(
    (signal) => getIssueAttentionQueue({ queue, page, limit: PAGE_SIZE }, { signal }),
    `attention:${queue}:${page}`,
  );

  function selectQueue(next: AttentionQueue) {
    router.push(`/dashboard/attention?queue=${next}`);
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Attention queues" className="flex flex-wrap gap-2">
        {ATTENTION_QUEUES.map((key) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={queue === key ? "default" : "outline"}
            aria-pressed={queue === key}
            onClick={() => selectQueue(key)}
          >
            {QUEUE_META[key].label}
          </Button>
        ))}
      </nav>

      <section aria-labelledby="attention-queue-heading" className="space-y-4">
        <div>
          <h2 id="attention-queue-heading" className="font-display text-xl font-semibold">
            {QUEUE_META[queue].label}
          </h2>
          <p className="text-muted-foreground text-sm">{QUEUE_META[queue].description}</p>
        </div>

        {resource.status === "loading" && <QueueSkeleton />}
        {resource.status === "error" && (
          <LoadError
            message={loadErrorMessage(resource.error, "the Issue attention queue")}
            onRetry={reload}
            signIn={resource.error.status === 401}
          />
        )}
        {resource.status === "success" &&
          (resource.data.items.length === 0 ? (
            resource.data.total > 0 ? (
              <EmptyState
                title="No issues on this page"
                description="This page is past the last page of the queue."
                action={
                  <Button asChild variant="outline">
                    <Link href={`/dashboard/attention?queue=${queue}`}>Back to first page</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="This queue is clear"
                description="There are no issues waiting in this queue right now."
              />
            )
          ) : (
            <>
              <ul aria-label={`${QUEUE_META[queue].label} issues`} className="grid gap-3">
                {resource.data.items.map((item) => (
                  <li key={item._id}>
                    <AttentionItem item={item} />
                  </li>
                ))}
              </ul>
              <PaginationNav
                page={resource.data.page}
                totalPages={resource.data.totalPages}
                basePath="/dashboard/attention"
                label={`${QUEUE_META[queue].label} pages`}
                params={{ queue }}
              />
            </>
          ))}
      </section>
    </div>
  );
}
