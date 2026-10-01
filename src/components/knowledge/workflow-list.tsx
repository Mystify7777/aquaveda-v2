"use client";

import Link from "next/link";

import { WorkflowSummaryCard } from "@/components/knowledge/workflow-summary-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getMyKnowledge,
  getReviewQueue,
} from "@/lib/api/knowledge";
import type { KnowledgeStatus } from "@/lib/api/types/knowledge";
import { useApiResource } from "@/lib/api/use-api-resource";
import { KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS } from "@/lib/knowledge/status";

function ListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="grid gap-4 sm:grid-cols-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

/**
 * The caller's own Knowledge (GET /knowledge/mine). Page and status live
 * in the URL (server page parses them); the fetch is client-side because
 * it needs the API-origin session cookie.
 */
export function MyKnowledgeList({ page, status }: { page: number; status?: KnowledgeStatus }) {
  const { resource, reload } = useApiResource(
    () => getMyKnowledge({ page, status }),
    `mine:${page}:${status ?? ""}`,
  );
  const base = "/protected/learn/mine";

  return (
    <div className="space-y-6">
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {[undefined, ...KNOWLEDGE_STATUSES].map((s) => (
          <Button
            key={s ?? "all"}
            asChild
            size="sm"
            variant={s === status ? "default" : "outline"}
          >
            <Link href={s ? `${base}?status=${s}` : base} aria-current={s === status ? "page" : undefined}>
              {s ? KNOWLEDGE_STATUS_LABELS[s] : "All"}
            </Link>
          </Button>
        ))}
      </nav>

      {resource.status === "loading" && <ListSkeleton label="Loading your articles..." />}
      {resource.status === "error" && (
        <LoadError
          message={loadErrorMessage(resource.error, "your articles")}
          onRetry={reload}
          signIn={resource.error.status === 401}
        />
      )}
      {resource.status === "success" &&
        (resource.data.items.length === 0 ? (
          resource.data.total > 0 ? (
            <EmptyState
              title="No articles on this page"
              description="This page is past the last page of your articles."
              action={
                <Button asChild variant="outline">
                  <Link href={status ? `${base}?status=${status}` : base}>Back to first page</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={status ? `No ${KNOWLEDGE_STATUS_LABELS[status].toLowerCase()} articles` : "No articles yet"}
              description={
                status
                  ? "You have no articles with this status."
                  : "Articles you write will appear here, in every status."
              }
              action={
                !status ? (
                  <Button asChild>
                    <Link href="/protected/learn/new">Write an article</Link>
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2">
              {resource.data.items.map((item) => (
                <li key={item._id}>
                  <WorkflowSummaryCard item={item} />
                </li>
              ))}
            </ul>
            <PaginationNav
              page={resource.data.page}
              totalPages={resource.data.totalPages}
              basePath={base}
              label="Your article pages"
              params={status ? { status } : undefined}
            />
          </>
        ))}
    </div>
  );
}

/**
 * Pending-review Knowledge (GET /knowledge/review-queue). Who may read it
 * is decided by the backend; a refusal is rendered, not pre-empted.
 */
export function ReviewQueueList({ page }: { page: number }) {
  const { resource, reload } = useApiResource(() => getReviewQueue({ page }), `queue:${page}`);
  const base = "/protected/learn/review";

  return (
    <div className="space-y-6">
      {resource.status === "loading" && <ListSkeleton label="Loading review queue..." />}
      {resource.status === "error" && (
        <LoadError
          message={loadErrorMessage(resource.error, "the review queue")}
          onRetry={reload}
          signIn={resource.error.status === 401}
        />
      )}
      {resource.status === "success" &&
        (resource.data.items.length === 0 ? (
          resource.data.total > 0 ? (
            <EmptyState
              title="No articles on this page"
              description="This page is past the last page of the queue."
              action={
                <Button asChild variant="outline">
                  <Link href={base}>Back to first page</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="The review queue is empty"
              description="Articles submitted for review by other authors will appear here."
            />
          )
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2">
              {resource.data.items.map((item) => (
                <li key={item._id}>
                  <WorkflowSummaryCard item={item} showAuthor />
                </li>
              ))}
            </ul>
            <PaginationNav
              page={resource.data.page}
              totalPages={resource.data.totalPages}
              basePath={base}
              label="Review queue pages"
            />
          </>
        ))}
    </div>
  );
}
