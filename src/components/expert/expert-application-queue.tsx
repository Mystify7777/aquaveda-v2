"use client";

import * as React from "react";
import Link from "next/link";

import {
  ExpertApplicationDecision,
  type ExpertDecision,
} from "@/components/expert/expert-application-decision";
import { useExpertStatus } from "@/components/expert/expert-status-provider";
import { SubmissionDetails } from "@/components/expert/submission-details";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { getPendingExpertApplications } from "@/lib/api/expert-application";
import type { ExpertApplicationForReview } from "@/lib/api/types/expert-application";
import { useApiResource } from "@/lib/api/use-api-resource";
import { previousAttempts } from "@/lib/expert/attempts";
import { ADMIN_EXPERT_APPLICATIONS_HREF } from "@/lib/expert/role-links";
import { formatDate } from "@/lib/format-date";

const LEGACY_REVIEW =
  "No details provided: this application was submitted before details were required. You can still decide it.";

function ApplicationDetail({
  item,
  headingRef,
  onDecided,
  onStale,
}: {
  item: ExpertApplicationForReview;
  headingRef: React.Ref<HTMLHeadingElement>;
  onDecided: (d: ExpertDecision) => void;
  onStale: () => void;
}) {
  const attempts = previousAttempts(item.history);
  return (
    <article aria-label={`Application from ${item.name}`} className="border-border space-y-5 rounded-xl border p-5">
      <header className="space-y-1">
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-xl font-semibold outline-none">
          {item.name}
        </h2>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          {item.requestedAt && <span>Applied {formatDate(item.requestedAt)}</span>}
          {attempts.length > 0 && <Badge variant="outline">Re-application</Badge>}
          {item.submission === null && <Badge variant="outline">No details</Badge>}
        </p>
      </header>

      {item.bio && <p className="text-sm leading-relaxed">{item.bio}</p>}

      <SubmissionDetails submission={item.submission} legacyMessage={LEGACY_REVIEW} />

      {attempts.length > 0 && (
        <section aria-label="Previous applications" className="space-y-2">
          <h3 className="text-sm font-medium">Previous applications</h3>
          {attempts.map((a) => (
            <details key={a.submittedAt} className="border-border rounded-md border p-3 text-sm">
              <summary className="cursor-pointer">
                Submitted {formatDate(a.submittedAt)}
                {a.outcome && (
                  <>
                    {" · "}
                    {a.outcome.toStatus === "rejected" ? "not approved" : "approved"} {formatDate(a.outcome.at)}
                  </>
                )}
              </summary>
              <div className="mt-3 space-y-3">
                {a.outcome?.note && (
                  <p className="text-muted-foreground">
                    Reviewer note: <span className="text-foreground">“{a.outcome.note}”</span>
                  </p>
                )}
                <SubmissionDetails submission={a.submission} legacyMessage={LEGACY_REVIEW} />
              </div>
            </details>
          ))}
        </section>
      )}

      <ExpertApplicationDecision
        key={`${item.userId}:${item.revision}`}
        userId={item.userId}
        name={item.name}
        revision={item.revision}
        onDecided={onDecided}
        onStale={onStale}
      />
    </article>
  );
}

/**
 * ADMIN governance queue (GET /expert-application): master-detail (list, then
 * the selected application in full). Who may read it is the backend's decision
 * (ADMIN only); a refusal is rendered, not pre-empted. This is NOT the Knowledge
 * review queue (/learn/review, EXPERT-only). Decisions name the revision shown;
 * after one, the list is re-read, the nav count is refreshed, and focus moves to
 * the next application (or the outcome message when none remain).
 */
export function ExpertApplicationQueue({ page }: { page: number }) {
  const { resource, reload } = useApiResource(
    () => getPendingExpertApplications({ page }),
    `expert-queue:${page}`,
  );
  const status = useExpertStatus();
  const [decisions, setDecisions] = React.useState<ExpertDecision[]>([]);
  const [stale, setStale] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const decisionsRef = React.useRef<HTMLUListElement>(null);
  const focusAfterReload = React.useRef(false);

  React.useEffect(() => {
    if (!focusAfterReload.current || resource.status !== "success") return;
    focusAfterReload.current = false;
    (headingRef.current ?? decisionsRef.current)?.focus();
  }, [resource]);

  function handleDecided(decision: ExpertDecision) {
    setDecisions((prev) => [decision, ...prev]);
    setStale(null);
    setSelectedId(null); // fall back to the first remaining application
    focusAfterReload.current = true;
    reload(); // the decided application leaves the pending queue
    void status.refresh();
  }

  function handleStale() {
    setStale("An application changed or was decided elsewhere while you were reviewing it. The queue was refreshed.");
    focusAfterReload.current = true;
    reload();
    void status.refresh();
  }

  const items = resource.status === "success" ? resource.data.items : [];
  const selected = items.find((i) => i.userId === selectedId) ?? items[0];

  return (
    <div className="space-y-6">
      {decisions.length > 0 && (
        <ul aria-label="Recent decisions" ref={decisionsRef} tabIndex={-1} className="space-y-2 outline-none">
          {decisions.map((d) => (
            <li key={`${d.userId}-${d.decision}`} role="status" className="border-border bg-muted/40 rounded-md border p-3 text-sm">
              {d.decision === "approved"
                ? `Approved ${d.name}. They now have Expert access.`
                : `Rejected ${d.name}'s application.`}
            </li>
          ))}
        </ul>
      )}

      {stale && (
        <p role="status" className="text-muted-foreground text-sm">
          {stale}
        </p>
      )}

      {resource.status === "loading" && (
        <div role="status" className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <span className="sr-only">Loading expert applications...</span>
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
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
        (items.length === 0 ? (
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
            <div className="grid gap-6 lg:grid-cols-[minmax(14rem,18rem)_1fr]">
              <nav aria-label="Pending applications">
                <ul className="space-y-2">
                  {items.map((item) => {
                    const active = item.userId === selected?.userId;
                    return (
                      <li key={item.userId}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(item.userId)}
                          aria-current={active ? "true" : undefined}
                          className={`border-border hover:bg-muted w-full rounded-md border p-3 text-left text-sm ${active ? "bg-muted" : ""}`}
                        >
                          <span className="block font-medium">{item.name}</span>
                          <span className="text-muted-foreground block text-xs">
                            {item.requestedAt ? `Applied ${formatDate(item.requestedAt)}` : "Pending"}
                            {item.submission === null ? " · no details" : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              {selected && (
                <ApplicationDetail
                  key={selected.userId}
                  item={selected}
                  headingRef={headingRef}
                  onDecided={handleDecided}
                  onStale={handleStale}
                />
              )}
            </div>
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
