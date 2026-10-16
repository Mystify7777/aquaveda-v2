"use client";

import * as React from "react";
import Link from "next/link";

import {
  ExpertApplicationDecision,
  type ExpertDecision,
} from "@/components/expert/expert-application-decision";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { getPendingExpertApplications } from "@/lib/api/expert-application";
import type { ExpertApplicationForReview } from "@/lib/api/types/expert-application";
import { useApiResource } from "@/lib/api/use-api-resource";
import { ADMIN_EXPERT_APPLICATIONS_HREF } from "@/lib/expert/role-links";
import { formatDate } from "@/lib/format-date";

function previousRejection(item: ExpertApplicationForReview) {
  return [...item.history].reverse().find((h) => h.toStatus === "rejected");
}

/**
 * ADMIN governance queue (GET /expert-application). Who may read it is the
 * backend's decision (ADMIN only); a refusal is rendered, not pre-empted.
 * This is NOT the Knowledge review queue (/learn/review, EXPERT-only).
 */
export function ExpertApplicationQueue({ page }: { page: number }) {
  const { resource, reload } = useApiResource(
    () => getPendingExpertApplications({ page }),
    `expert-queue:${page}`,
  );
  const [decisions, setDecisions] = React.useState<ExpertDecision[]>([]);
  const [stale, setStale] = React.useState(false);

  function handleDecided(decision: ExpertDecision) {
    setDecisions((prev) => [decision, ...prev]);
    reload(); // the decided application leaves the pending queue
  }

  function handleStale() {
    setStale(true);
    reload();
  }

  return (
    <div className="space-y-6">
      {decisions.length > 0 && (
        <ul aria-label="Recent decisions" className="space-y-2">
          {decisions.map((d) => (
            <li
              key={`${d.userId}-${d.decision}`}
              role="status"
              className="border-border bg-muted/40 rounded-md border p-3 text-sm"
            >
              {d.decision === "approved"
                ? `Approved ${d.name}. They now have Expert access.`
                : `Rejected ${d.name}'s application.`}
            </li>
          ))}
        </ul>
      )}

      {stale && (
        <p role="status" className="text-muted-foreground text-sm">
          One application had already been decided elsewhere; the queue was refreshed.
        </p>
      )}

      {resource.status === "loading" && (
        <div role="status" className="grid gap-4 sm:grid-cols-2">
          <span className="sr-only">Loading expert applications...</span>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      )}

      {resource.status === "error" && (
        <LoadError
          message={loadErrorMessage(resource.error, "Expert applications")}
          onRetry={reload}
          signIn={resource.error.status === 401}
        />
      )}

      {resource.status === "success" &&
        (resource.data.items.length === 0 ? (
          resource.data.total > 0 ? (
            <EmptyState
              title="No applications on this page"
              description="This page is past the last page of the queue."
              action={
                <Button asChild variant="outline">
                  <Link href={ADMIN_EXPERT_APPLICATIONS_HREF}>Back to first page</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No pending applications"
              description="Requests to become an Expert will appear here for review."
            />
          )
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2">
              {resource.data.items.map((item) => {
                const rejected = previousRejection(item);
                return (
                  <li key={item.userId}>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          <h2>{item.name}</h2>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm">
                        {item.requestedAt && (
                          <p className="text-muted-foreground">Applied {formatDate(item.requestedAt)}</p>
                        )}
                        {item.bio && <p className="leading-relaxed">{item.bio}</p>}
                        {rejected && (
                          <p className="text-muted-foreground">
                            Re-application. Previously rejected {formatDate(rejected.timestamp)}
                            {rejected.note ? <> with note “{rejected.note}”</> : null}.
                          </p>
                        )}
                        <ExpertApplicationDecision
                          userId={item.userId}
                          name={item.name}
                          onDecided={handleDecided}
                          onStale={handleStale}
                        />
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
            <PaginationNav
              page={resource.data.page}
              totalPages={resource.data.totalPages}
              basePath={ADMIN_EXPERT_APPLICATIONS_HREF}
              label="Expert application pages"
            />
          </>
        ))}
    </div>
  );
}
